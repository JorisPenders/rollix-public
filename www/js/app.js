/**
 * Rollix — static MVP build.
 *
 * Vanilla-JS port of the React app (frontend/src/{App,api,filters,viewport}.ts
 * + components/{Map,FilterSidebar,AccommodationDetail}.tsx) that reads
 * accommodations from a bundled data/accommodations.json file instead of a
 * FastAPI backend, so the whole thing is static files that can be hosted
 * anywhere (e.g. GitHub Pages) with no server or database to stand up.
 * Keep this in sync with the React source by hand if that changes.
 */
(function () {
  "use strict";

  const DATA_URL = "data/accommodations.json";
  const MAX_SHOWN = 30;
  const FRANCE_CENTER = [46.6, 2.3];

  const PIN_COLORS = {
    camping: { base: "var(--color-camping)", selected: "var(--color-camping-700)" },
    bungalow: { base: "var(--color-bungalow)", selected: "var(--color-bungalow-700)" },
    mixed: { base: "var(--color-mixed)", selected: "var(--color-mixed-700)" },
  };

  const ACCESSIBILITY_OPTIONS = [
    { key: "moteur", field: "handicap_moteur", label: "Motor / wheelchair" },
    { key: "visuel", field: "handicap_visuel", label: "Visual" },
    { key: "auditif", field: "handicap_auditif", label: "Hearing" },
    { key: "mental", field: "handicap_mental", label: "Cognitive" },
  ];

  // ---- state -----------------------------------------------------------
  const state = {
    accommodations: [],
    error: null,
    search: "",
    filters: {
      moteur: false,
      visuel: false,
      auditif: false,
      mental: false,
      categories: new Set(),
    },
    selectedId: null,
    dialogOpen: false,
    mapBounds: null,
    mapCenter: null,
  };

  // ---- pure helpers (ported from filters.ts / viewport.ts) -------------
  function availableCategories(accommodations) {
    const categories = new Set();
    for (const c of accommodations) {
      if (c.category) categories.add(c.category);
    }
    return [...categories].sort((a, b) => a.localeCompare(b));
  }

  function matchesFilters(accommodation, search, filters) {
    const q = search.trim().toLowerCase();
    if (q) {
      const haystack = `${accommodation.commune ?? ""} ${accommodation.postcode ?? ""} ${accommodation.name}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    for (const { key, field } of ACCESSIBILITY_OPTIONS) {
      if (filters[key] && accommodation[field] !== true) return false;
    }
    if (filters.categories.size > 0) {
      if (!accommodation.category || !filters.categories.has(accommodation.category)) {
        return false;
      }
    }
    return true;
  }

  function getShownAccommodations(filtered, bounds, center, max) {
    max = max || MAX_SHOWN;
    const located = filtered.filter((c) => c.latitude !== null && c.longitude !== null);

    if (!bounds || !center) return located.slice(0, max);

    const inView = located.filter((c) => bounds.contains([c.latitude, c.longitude]));
    const pool = inView.length ? inView : located;

    const sorted = [...pool].sort((a, b) => {
      const da = (a.latitude - center.lat) ** 2 + (a.longitude - center.lng) ** 2;
      const db = (b.latitude - center.lat) ** 2 + (b.longitude - center.lng) ** 2;
      return da - db;
    });

    return sorted.slice(0, max);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[c]);
  }

  function swatchClassForCategory(category) {
    if (category === "Camping") return "pin-swatch-camping";
    if (category === "Bungalow") return "pin-swatch-bungalow";
    return "pin-swatch-mixed";
  }

  function groupPinCategory(sites) {
    const categories = new Set(sites.map((s) => s.category));
    if (categories.size === 1) {
      const only = [...categories][0];
      if (only === "Camping") return "camping";
      if (only === "Bungalow") return "bungalow";
    }
    return "mixed";
  }

  // ---- derived selectors -------------------------------------------------
  function getCategories() {
    return availableCategories(state.accommodations);
  }

  function getFilteredAccommodations() {
    return state.accommodations.filter((c) => matchesFilters(c, state.search, state.filters));
  }

  function getShown(filtered) {
    return getShownAccommodations(filtered, state.mapBounds, state.mapCenter);
  }

  function getSelected() {
    return state.accommodations.find((c) => c.id === state.selectedId) || null;
  }

  // ---- DOM refs -----------------------------------------------------------
  const els = {
    search: document.getElementById("search"),
    categoryFilters: document.getElementById("category-filters"),
    accessibilityFilters: document.getElementById("accessibility-filters"),
    resultCount: document.getElementById("result-count"),
    accommodationList: document.getElementById("accommodation-list"),
    detailPanel: document.getElementById("detail-panel"),
    errorBanner: document.getElementById("error-banner"),
  };

  // ---- rendering: filter sidebar -----------------------------------------
  function renderAccessibilityFilters() {
    els.accessibilityFilters.querySelectorAll("input[data-filter-key]").forEach((input) => {
      input.checked = state.filters[input.dataset.filterKey];
      input.onchange = () => {
        state.filters[input.dataset.filterKey] = input.checked;
        onFiltersChanged();
      };
    });
  }

  function renderCategoryFilters() {
    const categories = getCategories();
    els.categoryFilters.innerHTML = "";
    if (categories.length === 0) {
      const p = document.createElement("p");
      p.className = "text-muted";
      p.style.fontSize = "13px";
      p.textContent = "No accommodation types loaded yet.";
      els.categoryFilters.appendChild(p);
      return;
    }
    for (const category of categories) {
      const label = document.createElement("label");
      label.className = "checkbox-row";
      label.innerHTML = `
        <input type="checkbox" ${state.filters.categories.has(category) ? "checked" : ""} />
        <span class="pin-swatch ${swatchClassForCategory(category)}" aria-hidden="true"></span>
        ${escapeHtml(category)}
      `;
      label.querySelector("input").onchange = (e) => {
        if (e.target.checked) state.filters.categories.add(category);
        else state.filters.categories.delete(category);
        onFiltersChanged();
      };
      els.categoryFilters.appendChild(label);
    }
  }

  function accommodationTagsHtml(a) {
    const tags = [];
    if (a.category) tags.push(`<span class="tag tag-outline">${escapeHtml(a.category)}</span>`);
    if (a.handicap_moteur === true) tags.push('<span class="tag tag-accent">Motor</span>');
    if (a.handicap_visuel === true) tags.push('<span class="tag tag-neutral">Visual</span>');
    if (a.handicap_auditif === true) tags.push('<span class="tag tag-neutral">Hearing</span>');
    if (a.handicap_mental === true) tags.push('<span class="tag tag-neutral">Cognitive</span>');
    return `<div class="tag-row">${tags.join("")}</div>`;
  }

  function renderList() {
    const filtered = getFilteredAccommodations();
    const shown = getShown(filtered);

    els.resultCount.textContent = `Showing ${shown.length} of ${filtered.length} in view`;

    els.accommodationList.innerHTML = "";
    if (shown.length === 0) {
      const p = document.createElement("p");
      p.className = "text-muted";
      p.style.fontSize = "13px";
      p.textContent = "No accommodations match these filters.";
      els.accommodationList.appendChild(p);
      return;
    }

    for (const site of shown) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "card blueprint" + (site.id === state.selectedId ? " is-selected" : "");
      btn.dataset.id = site.id;
      btn.innerHTML = `
        <i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>
        <div class="card-thumb">photo</div>
        <div class="card-body">
          <p class="card-kicker">${escapeHtml([site.postcode, site.commune].filter(Boolean).join(" "))}</p>
          <h3 class="card-title">${escapeHtml(site.name)}</h3>
          <span class="rating text-muted">☆☆☆☆☆ <span class="rating-note">(no ratings yet)</span></span>
          ${accommodationTagsHtml(site)}
        </div>
      `;
      btn.onclick = () => selectAccommodation(site.id);
      els.accommodationList.appendChild(btn);
    }

    if (state.selectedId) {
      const el = els.accommodationList.querySelector(`[data-id="${CSS.escape(state.selectedId)}"]`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  // ---- rendering: detail panel --------------------------------------------
  function renderDetailPanel() {
    const selected = getSelected();
    if (!state.dialogOpen || !selected) {
      els.detailPanel.hidden = true;
      els.detailPanel.innerHTML = "";
      return;
    }
    els.detailPanel.hidden = false;

    const noTags =
      !selected.handicap_moteur &&
      !selected.handicap_visuel &&
      !selected.handicap_auditif &&
      !selected.handicap_mental;
    const link = selected.website || selected.source_url;

    const tags = [];
    if (selected.handicap_moteur === true) tags.push('<span class="tag tag-accent">Motor / wheelchair accessible</span>');
    if (selected.handicap_visuel === true) tags.push('<span class="tag tag-neutral">Visual accessibility</span>');
    if (selected.handicap_auditif === true) tags.push('<span class="tag tag-neutral">Hearing accessibility</span>');
    if (selected.handicap_mental === true) tags.push('<span class="tag tag-neutral">Cognitive accessibility</span>');
    if (noTags) tags.push('<span class="tag tag-outline">Accessibility details not specified</span>');

    const addressLine = selected.address
      ? `<p>${escapeHtml(selected.address)}</p>`
      : selected.classification
        ? `<p>${escapeHtml(selected.classification)}</p>`
        : "";

    els.detailPanel.innerHTML = `
      <button type="button" class="btn btn-ghost detail-back">← Back to list</button>
      <div class="detail-thumb blueprint">
        <i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>
        <span>photo not provided by source dataset</span>
      </div>
      <div>
        <p class="card-kicker">${escapeHtml([selected.postcode, selected.commune].filter(Boolean).join(" "))}</p>
        <h2 class="dialog-title">${escapeHtml(selected.name)}</h2>
      </div>
      <p class="rating text-muted">☆☆☆☆☆ <span class="rating-note">no ratings yet</span></p>
      <div class="tag-row">${tags.join("")}</div>
      <div class="hr"></div>
      <div class="dialog-body">
        ${addressLine}
        <p class="text-muted">${escapeHtml(
          [selected.postcode, selected.commune].filter(Boolean).join(" ") +
            (selected.department ? `, ${selected.department}` : "") +
            `, ${selected.country}`,
        )}</p>
      </div>
      ${link ? `<a class="btn btn-primary btn-block" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">Visit website ↗</a>` : ""}
    `;
    els.detailPanel.querySelector(".detail-back").onclick = () => {
      state.dialogOpen = false;
      renderDetailPanel();
    };
  }

  // ---- map ----------------------------------------------------------------
  let map = null;
  let clusterGroup = null;
  let markerGroups = {}; // key -> { marker, sites }

  function markerIcon(isSelected, count, category) {
    const colors = PIN_COLORS[category];
    const fill = isSelected ? colors.selected : colors.base;
    const badge =
      count > 1
        ? `<circle cx="22" cy="3" r="7" fill="var(--color-bg)" stroke="${fill}" stroke-width="2"/>
           <text x="22" y="3.5" text-anchor="middle" dominant-baseline="middle" font-family="var(--font-body)" font-size="8.5" font-weight="700" fill="${fill}">${count > 9 ? "9+" : count}</text>`
        : "";
    return L.divIcon({
      className: "",
      html: `<svg width="28" height="38" viewBox="0 0 28 38" style="display:block;overflow:visible;filter:drop-shadow(0 2px 2px rgba(0,0,0,0.35))">
        <path d="M14 0C6.3 0 0 6.3 0 14c0 10 14 24 14 24s14-14 14-24c0-7.7-6.3-14-14-14z" fill="${fill}"/>
        <circle cx="14" cy="14" r="5.5" fill="var(--color-bg)"/>
        ${badge}
      </svg>`,
      iconSize: [28, 38],
      iconAnchor: [14, 38],
    });
  }

  function buildSiteTooltipHtml(site) {
    const place = [site.postcode, site.commune].filter(Boolean).join(" ");
    return `<div class="map-tooltip">
      <div class="map-tooltip-thumb blueprint">
        <i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>
        <span>no photo</span>
      </div>
      <div class="map-tooltip-body">
        ${place ? `<p class="card-kicker">${escapeHtml(place)}</p>` : ""}
        <p class="map-tooltip-title">${escapeHtml(site.name)}</p>
        <p class="rating text-muted">☆☆☆☆☆ <span class="rating-note">no ratings yet</span></p>
      </div>
    </div>`;
  }

  function buildGroupPopupHtml(sites) {
    const items = sites
      .map((s) => {
        const place = [s.postcode, s.commune].filter(Boolean).join(" ");
        return `<button type="button" class="btn btn-ghost map-popup-item" data-site-id="${escapeHtml(s.id)}">${escapeHtml(s.name)}${place ? `<span class="text-muted"> — ${escapeHtml(place)}</span>` : ""}</button>`;
      })
      .join("");
    return `<div class="map-popup"><p class="map-popup-title">${sites.length} accommodations at this location</p>${items}</div>`;
  }

  function groupByCoordinate(accommodations) {
    const groups = new Map();
    for (const site of accommodations) {
      if (site.latitude === null || site.longitude === null) continue;
      const key = `${site.latitude.toFixed(6)},${site.longitude.toFixed(6)}`;
      let group = groups.get(key);
      if (!group) {
        group = { key, lat: site.latitude, lon: site.longitude, sites: [] };
        groups.set(key, group);
      }
      group.sites.push(site);
    }
    return [...groups.values()];
  }

  function initMap() {
    map = L.map("map").setView(FRANCE_CENTER, 6);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);

    clusterGroup = L.markerClusterGroup({ chunkedLoading: true, maxClusterRadius: 40 });
    clusterGroup.addTo(map);

    map.on("moveend", reportViewport);
    reportViewport();
  }

  function reportViewport() {
    state.mapBounds = map.getBounds();
    state.mapCenter = map.getCenter();
    renderList();
  }

  function rebuildMarkers() {
    const filtered = getFilteredAccommodations();
    clusterGroup.clearLayers();
    markerGroups = {};
    const markers = [];

    groupByCoordinate(filtered).forEach((group) => {
      const isSelected = group.sites.some((s) => s.id === state.selectedId);
      const marker = L.marker([group.lat, group.lon], {
        icon: markerIcon(isSelected, group.sites.length, groupPinCategory(group.sites)),
      });

      if (group.sites.length === 1) {
        const site = group.sites[0];
        marker.on("click", () => selectAccommodation(site.id));
        marker.bindTooltip(buildSiteTooltipHtml(site), {
          direction: "top",
          offset: [0, -6],
          opacity: 1,
          className: "map-hover-tooltip",
        });
      } else {
        marker.bindTooltip(`${group.sites.length} accommodations here`, { direction: "top" });
        marker.bindPopup(buildGroupPopupHtml(group.sites), { className: "map-popup-wrapper" });
        marker.on("popupopen", () => {
          const el = marker.getPopup().getElement();
          if (!el || el.dataset.wired) return;
          el.dataset.wired = "1";
          el.addEventListener("click", (ev) => {
            const target = ev.target.closest("[data-site-id]");
            const id = target && target.getAttribute("data-site-id");
            if (!id) return;
            selectAccommodation(id);
            map.closePopup();
          });
        });
      }

      markerGroups[group.key] = { marker, sites: group.sites };
      markers.push(marker);
    });

    clusterGroup.addLayers(markers);
  }

  function updateMarkerSelection(prevId, nextId) {
    const affectedKeys = new Set();
    for (const [key, group] of Object.entries(markerGroups)) {
      if (group.sites.some((s) => s.id === prevId || s.id === nextId)) affectedKeys.add(key);
    }
    affectedKeys.forEach((key) => {
      const group = markerGroups[key];
      const isSelected = group.sites.some((s) => s.id === nextId);
      group.marker.setIcon(markerIcon(isSelected, group.sites.length, groupPinCategory(group.sites)));
    });
  }

  // ---- actions --------------------------------------------------------------
  function selectAccommodation(id) {
    const prevId = state.selectedId;
    state.selectedId = id;
    state.dialogOpen = true;
    updateMarkerSelection(prevId, id);
    renderList();
    renderDetailPanel();
  }

  function onFiltersChanged() {
    renderCategoryFilters();
    rebuildMarkers();
    renderList();
  }

  // ---- boot -------------------------------------------------------------
  function showError(message) {
    state.error = message;
    els.errorBanner.hidden = false;
    els.errorBanner.textContent = `Failed to load accommodations: ${message}`;
  }

  function init() {
    initMap();
    renderAccessibilityFilters();
    renderCategoryFilters();
    renderList();

    els.search.addEventListener("input", (e) => {
      state.search = e.target.value;
      rebuildMarkers();
      renderList();
    });

    fetch(DATA_URL)
      .then((response) => {
        if (!response.ok) throw new Error(`${response.status}`);
        return response.json();
      })
      .then((data) => {
        state.accommodations = data;
        renderCategoryFilters();
        rebuildMarkers();
        renderList();
      })
      .catch((err) => showError(String(err && err.message ? err.message : err)));
  }

  document.addEventListener("DOMContentLoaded", init);
})();

/* ==========================================================================
   Various functions that we want to use within the template
   ========================================================================== */

/*jslint es6 */
'use strict';

// Constants for CDNs
const PLOTLY_URL = "https://cdn.jsdelivr.net/npm/plotly.js@3.6.0/dist/plotly.min.js";
const MERMAID_URL = "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";

// The site defaults to dark mode for first-time visitors, regardless of OS preference.
// This must match `default_color_mode` in _config.yml (baked server-side into <html data-theme>).
const DEFAULT_THEME = "dark";

// Determine the computed theme, which can be "dark" or "light".
function determineComputedTheme() {
  const themeSetting = localStorage.getItem("theme");
  return (themeSetting === "dark" || themeSetting === "light") ? themeSetting : DEFAULT_THEME;
}

// Set the theme on page load or when explicitly called
function setTheme(theme) {
  const use_theme = theme ||
    localStorage.getItem("theme") ||
    $("html").attr("data-theme") ||
    DEFAULT_THEME;

  if (use_theme === "dark") {
    $("html").attr("data-theme", "dark");
    $("#theme-icon").removeClass("fa-sun").addClass("fa-moon");
  } else if (use_theme === "light") {
    $("html").removeAttr("data-theme");
    $("#theme-icon").removeClass("fa-moon").addClass("fa-sun");
  }
}

// Toggle the theme manually
function toggleTheme() {
  const current_theme = $("html").attr("data-theme");
  const new_theme = current_theme === "dark" ? "light" : "dark";
  localStorage.setItem("theme", new_theme);
  setTheme(new_theme);
  redrawPlotly();
  redrawPhotoMap();
  redrawGeoGame();
}

/* ==========================================================================
   Mermaid integration (loaded on demand, re-run after in-page navigation)
   ========================================================================== */

let mermaidLoaded = false;

function renderMermaid() {
  const elements = document.querySelectorAll("pre>code.language-mermaid");
  if (elements.length === 0) {
    return;
  }

  if (!mermaidLoaded) {
    mermaidLoaded = true;
    const moduleScript = document.createElement('script');
    moduleScript.type = 'module';
    // Expose a re-runnable handle so that content swapped in by Swup can be
    // rendered without re-importing the module. Mermaid tags processed nodes
    // with `data-processed`, so calling run() again only touches new blocks.
    moduleScript.textContent = `
      import mermaid from '${MERMAID_URL}';
      mermaid.initialize({startOnLoad:false, theme:'default'});
      window.__mermaidRun = function () { return mermaid.run({querySelector:'code.language-mermaid'}); };
      window.__mermaidRun();
    `;
    document.body.appendChild(moduleScript);
  } else if (typeof window.__mermaidRun === "function") {
    window.__mermaidRun();
  }
}

/* ==========================================================================
   Plotly integration script so that Markdown codeblocks will be rendered
   ========================================================================== */

// Read the Plotly data from the code block, hide it, and render the chart as a new node. This allows for the
// JSON data to be retrieved when the theme is switched. Rendered blocks are tagged with `data-plotly-done`
// so they are only rendered once and can be redrawn on theme change / re-scanned after a Swup navigation.
//
// NOTE that plotlyDarkLayout and plotlyLightLayout will be exposed in the minimized file
let plotlyLoading = false;

function applyPlotlyTheme(jsonData) {
  const theme = (determineComputedTheme() === "dark") ? plotlyDarkLayout : plotlyLightLayout;
  if (jsonData.layout) {
    jsonData.layout.template = (jsonData.layout.template) ? { ...theme, ...jsonData.layout.template } : theme;
  } else {
    jsonData.layout = { template: theme };
  }
  return jsonData;
}

function renderPlotlyElement(elem) {
  // Parse the Plotly JSON data and hide the source block
  let jsonData = applyPlotlyTheme(JSON.parse(elem.textContent));
  elem.parentElement.classList.add("hidden");
  elem.setAttribute("data-plotly-done", "1");

  // Add the Plotly node right after the (hidden) source block
  let chartElement = document.createElement("div");
  elem.parentElement.after(chartElement);
  Plotly.react(chartElement, jsonData.data, jsonData.layout);
}

// Render any not-yet-rendered Plotly blocks, loading the library on demand.
function renderPlotly() {
  const pending = document.querySelectorAll("pre>code.language-plotly:not([data-plotly-done])");
  if (pending.length === 0) {
    return;
  }

  if (window.Plotly) {
    pending.forEach(renderPlotlyElement);
    return;
  }

  if (plotlyLoading) {
    return;
  }
  plotlyLoading = true;

  const script = document.createElement('script');
  script.src = PLOTLY_URL;
  script.async = true;
  script.onload = function () {
    plotlyLoading = false;
    document.querySelectorAll("pre>code.language-plotly:not([data-plotly-done])").forEach(renderPlotlyElement);
  };
  document.head.appendChild(script);
}

// Re-react already-rendered charts (used when the theme changes).
function redrawPlotly() {
  if (!window.Plotly) {
    return;
  }
  document.querySelectorAll("pre>code.language-plotly[data-plotly-done]").forEach(function (elem) {
    let jsonData = applyPlotlyTheme(JSON.parse(elem.textContent));
    let chartElement = elem.parentElement.nextElementSibling;
    if (chartElement) {
      Plotly.react(chartElement, jsonData.data, jsonData.layout);
    }
  });
}

/* ==========================================================================
   Research tabs — fluid "metaball" toggle (see /research/)
   ========================================================================== */

function initResearchTabs() {
  var tabsWrap = document.querySelector('.research-tabs');
  if (!tabsWrap || tabsWrap.dataset.tabsInit) {
    return;
  }
  var tabs = tabsWrap.querySelectorAll('.research-tabs__btn');
  var thumb = tabsWrap.querySelector('.research-tabs__thumb');
  var echo = tabsWrap.querySelector('.research-tabs__thumb-echo');
  if (!tabs.length) {
    return;
  }
  tabsWrap.dataset.tabsInit = '1';

  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var thumbLeft = 0;
  var thumbWidth = 0;
  var echoCleanupTimer;

  function setRect(el, left, width) {
    el.style.width = width + 'px';
    el.style.transform = 'translateX(' + left + 'px)';
  }

  // The thumb morphs into the echo's spot like a dumbbell, then the neck
  // between them thins and pinches off as the echo streams to the destination
  // and collapses (an SVG "goo" filter on the shared wrapper blurs the two
  // blobs together and re-sharpens the edge, so it reads as one liquid body).
  function moveThumb(btn, animate) {
    if (!thumb || !btn) {
      return;
    }
    var left = btn.offsetLeft;
    var width = btn.offsetWidth;

    if (!animate || reduceMotion || !echo) {
      thumb.style.transition = 'none';
      setRect(thumb, left, width);
      void thumb.offsetWidth;
      thumb.style.transition = '';
      thumbLeft = left;
      thumbWidth = width;
      return;
    }

    var prevLeft = thumbLeft;
    var prevWidth = thumbWidth;
    var destCenter = left + width / 2;

    window.clearTimeout(echoCleanupTimer);
    // Seed the trailing lobe exactly where the thumb was.
    echo.style.transition = 'none';
    echo.style.opacity = '1';
    setRect(echo, prevLeft, prevWidth);
    void echo.offsetWidth;
    echo.style.transition = '';

    setRect(thumb, left, width);
    thumbLeft = left;
    thumbWidth = width;

    requestAnimationFrame(function () {
      // The tail streams toward the destination and shrinks to nothing
      // *there*, so it's swallowed by the leading lobe instead of pinching
      // off and leaving a dying dot on the old option.
      setRect(echo, destCenter, 0);
      echo.style.opacity = '0';
    });

    echoCleanupTimer = window.setTimeout(function () {
      echo.style.transition = 'none';
      setRect(echo, destCenter, 0);
    }, 550);
  }

  function activate(key) {
    var current = document.querySelector('.research-panel.is-active');
    var next = document.getElementById('panel-' + key);
    var btn = tabsWrap.querySelector('.research-tabs__btn[data-panel="' + key + '"]');

    tabs.forEach(function (t) {
      t.classList.toggle('is-active', t.getAttribute('data-panel') === key);
    });
    moveThumb(btn, true);

    if (!next || next === current) {
      return;
    }

    if (current) {
      current.classList.remove('is-active');
      current.classList.add('is-leaving');
      window.setTimeout(function () {
        current.classList.remove('is-leaving');
        current.style.display = '';
      }, 200);
    }

    next.style.display = 'block';
    void next.offsetWidth;
    next.classList.add('is-active');

    // Cards in a panel that was `display: none` at initReadMore()'s first
    // pass measured scrollHeight 0 and were skipped, so re-run now that this
    // panel actually has layout. Already-initialized cards are no-ops.
    initReadMore();
  }

  // With only two tabs this behaves as a single fluid toggle: a click
  // anywhere in the bar (including the gaps and the already-active tab)
  // flips to the other option, not just clicks on the inactive button.
  tabsWrap.addEventListener('click', function (e) {
    var activeBtn = tabsWrap.querySelector('.research-tabs__btn.is-active');
    var clickedBtn = e.target.closest('.research-tabs__btn');
    var target = (clickedBtn && clickedBtn !== activeBtn) ? clickedBtn : null;

    if (!target) {
      var idx = Array.prototype.indexOf.call(tabs, activeBtn);
      target = tabs[(idx + 1) % tabs.length];
    }

    activate(target.getAttribute('data-panel'));
  });

  // Keep the pill aligned if the bar reflows (font load, resize).
  tabsWrap.__reposition = function () {
    moveThumb(tabsWrap.querySelector('.research-tabs__btn.is-active'), false);
  };

  moveThumb(tabsWrap.querySelector('.research-tabs__btn.is-active'), false);
}

// One global resize listener repositions whichever research bar is present.
window.addEventListener('resize', function () {
  var w = document.querySelector('.research-tabs');
  if (w && w.__reposition) {
    w.__reposition();
  }
});

/* ==========================================================================
   KaTeX math — re-typeset after in-page navigation
   ========================================================================== */

// KaTeX auto-render (loaded from the CDN in _includes/footer/custom.html) does
// the first-load typesetting itself. This re-typesets content swapped in by
// Swup, once the library is available. Already-rendered math has no delimiters
// left, so re-running is safe.
function renderMath() {
  if (typeof window.renderMathInElement !== "function") {
    return;
  }
  const scope = document.getElementById("page-content") || document.body;
  window.renderMathInElement(scope, {
    delimiters: [
      { left: "$$", right: "$$", display: true },
      { left: "\\(", right: "\\)", display: false },
      { left: "\\[", right: "\\]", display: true }
    ]
  });
}

/* ==========================================================================
   Photo gallery lightbox (used on /photos/)
   ========================================================================== */

// Document-level listeners are bound once and delegate to whichever gallery is
// currently mounted (via window.__photoLightbox), so Swup navigations don't
// stack duplicate handlers. Element-level listeners bind per gallery instance.
let photoDocBound = false;

function initPhotoLightbox() {
  var overlay = document.getElementById("lightbox-overlay");
  if (!overlay || overlay.dataset.lbInit) {
    return;
  }
  overlay.dataset.lbInit = "1";

  var overlayImg = overlay.querySelector(".lightbox-overlay__img");
  var closeBtn = overlay.querySelector(".lightbox-overlay__close");
  var prevBtn = overlay.querySelector(".lightbox-overlay__prev");
  var nextBtn = overlay.querySelector(".lightbox-overlay__next");
  var captionEl = overlay.querySelector(".lightbox-overlay__caption");
  var captionText = overlay.querySelector(".lightbox-overlay__caption-text");
  var captionLocation = overlay.querySelector(".lightbox-overlay__caption-location");
  var captionDate = overlay.querySelector(".lightbox-overlay__caption-date");
  var items = Array.prototype.slice.call(document.querySelectorAll(".photo-grid__item"));
  var currentIndex = -1;
  var zoomRect = null;

  function formatCaptionDate(isoDate) {
    if (!isoDate) {
      return "";
    }
    var parsed = new Date(isoDate + "T00:00:00");
    if (isNaN(parsed.getTime())) {
      return "";
    }
    return parsed.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  }

  function setCaption(caption, location, rawDate) {
    // The date is kept on the element (not shown -- see .lightbox-overlay__caption-date
    // in _photo-grid.scss) so it stays out of the visible/empty check below.
    captionText.textContent = caption || "";
    captionLocation.textContent = location || "";
    captionDate.textContent = formatCaptionDate(rawDate);
    captionEl.classList.toggle("is-empty", !caption && !location);
  }

  function updateCaption(item) {
    setCaption(
      item.getAttribute("data-caption"),
      item.getAttribute("data-location"),
      item.getAttribute("data-date")
    );
  }

  function showPhoto(index) {
    if (!items.length) {
      return;
    }
    currentIndex = (index + items.length) % items.length;
    var item = items[currentIndex];
    prevBtn.hidden = false;
    nextBtn.hidden = false;
    overlayImg.src = item.getAttribute("href");
    updateCaption(item);
    overlay.classList.add("is-active");
    document.body.classList.add("lightbox-open");
  }

  // Opens a single photo outside the gallery's item list -- used by callers
  // (like the geo-game) that show one photo at a time with no set to browse
  // through. Prev/next are hidden since there's nothing to navigate to.
  function showSinglePhoto(src, caption, location, date) {
    currentIndex = -1;
    prevBtn.hidden = true;
    nextBtn.hidden = true;
    overlayImg.src = src;
    setCaption(caption, location, date);
    overlay.classList.add("is-active");
    document.body.classList.add("lightbox-open");
  }

  function closeLightbox() {
    overlay.classList.remove("is-active");
    overlayImg.src = "";
    currentIndex = -1;
    document.body.classList.remove("lightbox-open");
  }

  function updateZoomOrigin(e) {
    if (!zoomRect) {
      return;
    }
    var x = ((e.clientX - zoomRect.left) / zoomRect.width) * 100;
    var y = ((e.clientY - zoomRect.top) / zoomRect.height) * 100;
    x = Math.max(0, Math.min(100, x));
    y = Math.max(0, Math.min(100, y));
    overlayImg.style.transformOrigin = x + "% " + y + "%";
  }

  function stopZoom() {
    overlayImg.classList.remove("is-zoomed");
    zoomRect = null;
  }

  items.forEach(function (item, index) {
    item.addEventListener("click", function (e) {
      e.preventDefault();
      showPhoto(index);
    });
  });

  closeBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    closeLightbox();
  });
  prevBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    showPhoto(currentIndex - 1);
  });
  nextBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    showPhoto(currentIndex + 1);
  });

  overlay.addEventListener("click", function (e) {
    if (e.target === overlay) {
      closeLightbox();
    }
  });

  // Press-and-hold to zoom into the photo, anchored under the cursor.
  overlayImg.addEventListener("mousedown", function (e) {
    e.preventDefault();
    e.stopPropagation();
    zoomRect = overlayImg.getBoundingClientRect();
    updateZoomOrigin(e);
    overlayImg.classList.add("is-zoomed");
  });

  // Swipe support for touch devices.
  var touchStartX = null;
  overlay.addEventListener("touchstart", function (e) {
    touchStartX = e.changedTouches[0].clientX;
  });
  overlay.addEventListener("touchend", function (e) {
    if (touchStartX === null) {
      return;
    }
    var deltaX = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(deltaX) > 40) {
      showPhoto(currentIndex + (deltaX < 0 ? 1 : -1));
    }
    touchStartX = null;
  });

  // Publish this gallery as the active controller for the shared document
  // listeners below.
  window.__photoLightbox = {
    isActive: function () { return overlay.classList.contains("is-active"); },
    isZoomed: function () { return overlayImg.classList.contains("is-zoomed"); },
    showPhoto: showPhoto,
    showSinglePhoto: showSinglePhoto,
    closeLightbox: closeLightbox,
    getIndex: function () { return currentIndex; },
    updateZoomOrigin: updateZoomOrigin,
    stopZoom: stopZoom,
    openByHref: function (href) {
      var index = items.map(function (item) { return item.getAttribute("href"); }).indexOf(href);
      if (index !== -1) {
        showPhoto(index);
      }
    }
  };

  if (!photoDocBound) {
    photoDocBound = true;
    document.addEventListener("mousemove", function (e) {
      var c = window.__photoLightbox;
      if (c && c.isZoomed()) {
        c.updateZoomOrigin(e);
      }
    });
    document.addEventListener("mouseup", function () {
      var c = window.__photoLightbox;
      if (c) {
        c.stopZoom();
      }
    });
    document.addEventListener("keydown", function (e) {
      var c = window.__photoLightbox;
      if (!c || !c.isActive()) {
        return;
      }
      if (e.key === "Escape") { c.closeLightbox(); }
      if (e.key === "ArrowRight") { c.showPhoto(c.getIndex() + 1); }
      if (e.key === "ArrowLeft") { c.showPhoto(c.getIndex() - 1); }
    });
  }
}

/* ==========================================================================
   Photo location map (used on /photos/)
   ========================================================================== */

const LEAFLET_JS_URL = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
const LEAFLET_CSS_URL = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";

let leafletLoading = false;
let photoMapInstance = null;
let photoMapTileLayer = null;

// CARTO's free basemaps (no API key) rather than raw openstreetmap.org tiles:
// same OpenStreetMap data underneath, but a muted style that doesn't clash
// with the site, plus a dark variant to match the theme toggle.
function photoMapTileConfig() {
  var dark = determineComputedTheme() === "dark";
  return {
    url: "https://{s}.basemaps.cartocdn.com/" + (dark ? "dark_all" : "light_all") + "/{z}/{x}/{y}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors ' +
      '&copy; <a href="https://carto.com/attributions">CARTO</a>'
  };
}

// A small filled dot in the site's accent color reads as part of the page;
// Leaflet's default pin icon is a generic "Google Maps"-style marker that
// doesn't match a minimal portfolio site.
function photoMarkerIcon() {
  return L.divIcon({
    className: "photo-map__marker",
    html: '<span class="photo-map__marker-dot"></span>',
    iconSize: [16, 16],
    iconAnchor: [8, 8],
    popupAnchor: [0, -10]
  });
}

// Leaflet is only needed on /photos/, so it's lazy-loaded on demand rather
// than bundled site-wide (same approach as Plotly/Mermaid above).
function loadLeaflet(callback) {
  if (window.L) {
    callback();
    return;
  }
  if (!document.querySelector('link[href="' + LEAFLET_CSS_URL + '"]')) {
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = LEAFLET_CSS_URL;
    document.head.appendChild(link);
  }
  if (leafletLoading) {
    document.addEventListener("leaflet:loaded", callback, { once: true });
    return;
  }
  leafletLoading = true;
  var script = document.createElement("script");
  script.src = LEAFLET_JS_URL;
  script.async = true;
  script.onload = function () {
    leafletLoading = false;
    document.dispatchEvent(new Event("leaflet:loaded"));
    callback();
  };
  document.head.appendChild(script);
}

function initPhotoMap() {
  var container = document.getElementById("photo-map");
  var dataEl = document.getElementById("photo-map-data");
  if (!container || !dataEl || container.dataset.mapInit) {
    return;
  }
  container.dataset.mapInit = "1";

  var points;
  try {
    points = JSON.parse(dataEl.textContent);
  } catch (e) {
    return;
  }
  if (!points.length) {
    return;
  }

  loadLeaflet(function () {
    // A Swup navigation swaps in a brand-new #photo-map node, so the old map
    // instance (still bound to the detached one) has to be torn down first.
    if (photoMapInstance) {
      photoMapInstance.remove();
      photoMapInstance = null;
    }

    // Plain scroll-wheel zoom is off permanently (not just toggled on click)
    // so scrolling the page past the map never hijacks the wheel -- Ctrl/Cmd
    // + scroll zooms instead, same convention as Google Maps/Mapbox embeds.
    // The +/- buttons, double-click zoom, and touch pinch-zoom are unaffected.
    var map = L.map(container, { scrollWheelZoom: false });
    photoMapInstance = map;
    // Drop Leaflet's own "Leaflet | 🇺🇦" prefix (added by default since 1.9)
    // so only our OpenStreetMap/CARTO credit line shows.
    map.attributionControl.setPrefix(false);

    var hint = document.createElement("div");
    hint.className = "photo-map__hint";
    hint.textContent = /Mac|iPhone|iPad/.test(navigator.platform) ? "Use ⌘ + scroll to zoom" : "Use Ctrl + scroll to zoom";
    container.appendChild(hint);
    var hintTimer = null;

    container.addEventListener("wheel", function (e) {
      if (e.ctrlKey || e.metaKey) {
        // Hand off to Leaflet's own (private, but stable at this pinned
        // 1.9.4) scroll-zoom handler rather than stepping whole zoom levels
        // ourselves -- it debounces and accumulates fractional deltas into
        // one animated zoom, which is what makes it feel smooth instead of
        // snapping instantly. It calls preventDefault/stopPropagation itself.
        map.scrollWheelZoom._onWheelScroll(e);
      } else {
        hint.classList.add("is-visible");
        clearTimeout(hintTimer);
        hintTimer = setTimeout(function () { hint.classList.remove("is-visible"); }, 1200);
      }
    }, { passive: false });

    var tileConfig = photoMapTileConfig();
    photoMapTileLayer = L.tileLayer(tileConfig.url, {
      attribution: tileConfig.attribution,
      subdomains: "abcd",
      maxZoom: 19
    }).addTo(map);

    var bounds = [];
    points.forEach(function (p) {
      var marker = L.marker([p.lat, p.lng], { icon: photoMarkerIcon() }).addTo(map);
      var popupCaption = p.caption ? '<div class="photo-map__popup-caption">' + p.caption + "</div>" : "";
      var popupLocation = p.location ? '<div class="photo-map__popup-location">' + p.location + "</div>" : "";
      marker.bindPopup(
        '<a href="' + p.full + '" class="photo-map__popup">' +
          '<img src="' + p.thumb + '" alt="">' +
          popupCaption + popupLocation +
        "</a>"
      );
      marker.on("popupopen", function (e) {
        var link = e.popup.getElement().querySelector(".photo-map__popup");
        link.addEventListener("click", function (evt) {
          evt.preventDefault();
          var lightbox = window.__photoLightbox;
          if (lightbox) {
            lightbox.openByHref(p.full);
          }
        });
      });
      bounds.push([p.lat, p.lng]);
    });

    if (bounds.length === 1) {
      map.setView(bounds[0], 10);
    } else {
      map.fitBounds(bounds, { padding: [30, 30] });
    }
  });
}

// Swap the basemap style when the theme toggle flips (used alongside
// redrawPlotly() in toggleTheme()).
function redrawPhotoMap() {
  if (!photoMapInstance) {
    return;
  }
  var tileConfig = photoMapTileConfig();
  if (photoMapTileLayer) {
    photoMapInstance.removeLayer(photoMapTileLayer);
  }
  photoMapTileLayer = L.tileLayer(tileConfig.url, {
    attribution: tileConfig.attribution,
    subdomains: "abcd",
    maxZoom: 19
  }).addTo(photoMapInstance);
}

/* ==========================================================================
   GeoGuessr-style photo location game (used on the homepage, "/")
   ========================================================================== */

var GEO_GAME_ROUNDS = 5;   // photos guessed per game
var GEO_GAME_MAX_PTS = 5000; // per-round score for a bullseye
var GEO_GAME_SCALE = 1500; // km; larger = more forgiving score falloff

let geoGameMapInstance = null;
let geoGameTileLayer = null;

// Great-circle distance in km between two [lat, lng] points (Haversine).
function geoGameDistanceKm(a, b) {
  var R = 6371;
  var toRad = Math.PI / 180;
  var dLat = (b[0] - a[0]) * toRad;
  var dLng = (b[1] - a[1]) * toRad;
  var lat1 = a[0] * toRad;
  var lat2 = b[0] * toRad;
  var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Closer guesses score higher, with an exponential falloff so a bullseye is
// worth GEO_GAME_MAX_PTS and the score decays smoothly with distance.
function geoGameScore(distanceKm) {
  return Math.round(GEO_GAME_MAX_PTS * Math.exp(-distanceKm / GEO_GAME_SCALE));
}

function geoGameFormatDistance(km) {
  if (km < 1) {
    return Math.round(km * 1000) + " m";
  }
  if (km < 10) {
    return km.toFixed(1) + " km";
  }
  return Math.round(km).toLocaleString() + " km";
}

function geoGamePinIcon(variant) {
  return L.divIcon({
    className: "geo-game__pin geo-game__pin--" + variant,
    html: '<span class="geo-game__pin-dot"></span>',
    iconSize: [18, 18],
    iconAnchor: [9, 9]
  });
}

// Local best score, kept in localStorage so it survives reloads but is only
// ever shown once the player has actually finished a game (see endGame()).
var GEO_GAME_HIGH_SCORE_KEY = "geoGameHighScore";

function geoGameGetHighScore() {
  try {
    var v = window.localStorage.getItem(GEO_GAME_HIGH_SCORE_KEY);
    return v === null ? null : parseInt(v, 10);
  } catch (e) {
    return null; // localStorage unavailable (private browsing, etc.)
  }
}

function geoGameSetHighScore(score) {
  try {
    window.localStorage.setItem(GEO_GAME_HIGH_SCORE_KEY, String(score));
  } catch (e) {
    // ignore -- best score just won't persist
  }
}

// Fisher-Yates shuffle over a copy, so each game draws photos in a fresh order.
function geoGameShuffle(list) {
  var arr = list.slice();
  for (var i = arr.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

function initGeoGame() {
  var root = document.getElementById("geo-game");
  var dataEl = document.getElementById("geo-game-data");
  if (!root || !dataEl || root.dataset.gameInit) {
    return;
  }

  var allPoints;
  try {
    allPoints = JSON.parse(dataEl.textContent);
  } catch (e) {
    return;
  }
  if (!allPoints || allPoints.length < 2) {
    return;
  }
  root.dataset.gameInit = "1";

  var mapEl = root.querySelector("#geo-game-map");
  var photoFigure = root.querySelector(".geo-game__photo");
  var photoImg = root.querySelector(".geo-game__photo-img");
  var photoCaption = root.querySelector(".geo-game__photo-caption");
  var photoName = root.querySelector(".geo-game__photo-name");
  var photoPlace = root.querySelector(".geo-game__photo-place");
  var mapHint = root.querySelector(".geo-game__map-hint");
  var roundEl = root.querySelector(".geo-game__round");
  var scoreEl = root.querySelector(".geo-game__score");
  var bestEl = root.querySelector(".geo-game__best");
  var distanceEl = root.querySelector(".geo-game__distance");
  var guessBtn = root.querySelector(".geo-game__guess");
  var nextBtn = root.querySelector(".geo-game__next");
  var finalEl = root.querySelector(".geo-game__final");
  var finalText = root.querySelector(".geo-game__final-text");
  var replayBtn = root.querySelector(".geo-game__replay");

  loadLeaflet(function () {
    // A Swup navigation swaps in a fresh #geo-game-map node, so any previous
    // instance (bound to the now-detached node) must be torn down first.
    if (geoGameMapInstance) {
      geoGameMapInstance.remove();
      geoGameMapInstance = null;
    }

    var map = L.map(mapEl, {
      worldCopyJump: true,
      minZoom: 1,
      zoomControl: true
    }).setView([20, 0], 1);
    geoGameMapInstance = map;
    map.attributionControl.setPrefix(false);

    var tileConfig = photoMapTileConfig();
    geoGameTileLayer = L.tileLayer(tileConfig.url, {
      attribution: tileConfig.attribution,
      subdomains: "abcd",
      maxZoom: 19,
      noWrap: false
    }).addTo(map);

    var rounds = geoGameShuffle(allPoints).slice(0, Math.min(GEO_GAME_ROUNDS, allPoints.length));
    var roundIndex = 0;
    var totalScore = 0;
    var guessLatLng = null;
    var guessMarker = null;
    var actualMarker = null;
    var line = null;
    var settled = false; // true once the current round has been guessed

    function clearMapLayers() {
      if (guessMarker) { map.removeLayer(guessMarker); guessMarker = null; }
      if (actualMarker) { map.removeLayer(actualMarker); actualMarker = null; }
      if (line) { map.removeLayer(line); line = null; }
    }

    // Opens the full-size photo in the shared lightbox (see initPhotoLightbox),
    // same as clicking a thumbnail on /photos/ -- but as a single photo with
    // no prev/next, since browsing ahead would spoil future rounds' answers.
    // Before the round is settled, the caption/location/date are withheld
    // since they'd hand over the answer -- only revealed once guessed.
    function openPhoto(p) {
      var lightbox = window.__photoLightbox;
      if (!lightbox) {
        return;
      }
      if (settled) {
        lightbox.showSinglePhoto(p.full, p.caption, p.location, p.date);
      } else {
        lightbox.showSinglePhoto(p.full);
      }
    }

    photoImg.addEventListener("click", function () {
      openPhoto(rounds[roundIndex]);
    });

    // Only revealed once a high score actually exists, i.e. after the
    // player's first completed game -- nothing to show before that.
    function updateBestDisplay() {
      var best = geoGameGetHighScore();
      bestEl.hidden = (best === null);
      if (best !== null) {
        bestEl.textContent = "Best: " + best.toLocaleString() + " pts";
      }
    }
    updateBestDisplay();

    function startRound() {
      settled = false;
      guessLatLng = null;
      clearMapLayers();
      var p = rounds[roundIndex];
      photoImg.src = p.thumb;
      photoImg.alt = "Photo " + (roundIndex + 1) + " to locate";
      photoCaption.hidden = true; // stays hidden until the guess is in
      photoFigure.classList.remove("is-viewable");
      roundEl.textContent = "Round " + (roundIndex + 1) + " / " + rounds.length;
      scoreEl.textContent = totalScore.toLocaleString() + " pts";
      // The result line keeps its reserved space (see .geo-game__result), so
      // clearing the text avoids any reflow that would resize the photo.
      distanceEl.textContent = "";
      mapHint.classList.remove("is-hidden");
      guessBtn.hidden = false;
      guessBtn.disabled = true;
      nextBtn.hidden = true;
      map.setView([20, 0], 1);
    }

    function submitGuess() {
      if (!guessLatLng || settled) {
        return;
      }
      settled = true;
      var p = rounds[roundIndex];
      var actual = [p.lat, p.lng];
      var distanceKm = geoGameDistanceKm([guessLatLng.lat, guessLatLng.lng], actual);
      var pts = geoGameScore(distanceKm);
      totalScore += pts;

      actualMarker = L.marker(actual, { icon: geoGamePinIcon("actual") }).addTo(map);
      var popupCaption = p.caption ? '<div class="photo-map__popup-caption">' + p.caption + "</div>" : "";
      var popupLocation = p.location ? '<div class="photo-map__popup-location">' + p.location + "</div>" : "";
      actualMarker.bindPopup(
        '<a href="' + p.full + '" class="photo-map__popup">' +
          '<img src="' + p.thumb + '" alt="">' +
          popupCaption + popupLocation +
        "</a>"
      );
      actualMarker.on("popupopen", function (e) {
        var link = e.popup.getElement().querySelector(".photo-map__popup");
        link.addEventListener("click", function (evt) {
          evt.preventDefault();
          openPhoto(p);
        });
      });

      line = L.polyline([[guessLatLng.lat, guessLatLng.lng], actual], {
        className: "geo-game__line",
        dashArray: "6 8"
      }).addTo(map);

      map.fitBounds(L.latLngBounds([[guessLatLng.lat, guessLatLng.lng], actual]), {
        padding: [50, 50],
        maxZoom: 8
      });
      actualMarker.openPopup();

      // Reveal the photo's name + place as a caption overlay, mirroring the
      // gallery hover. Hidden entirely if this photo has neither.
      photoName.textContent = p.caption || "";
      photoPlace.textContent = p.location || "";
      photoCaption.hidden = !(p.caption || p.location);
      photoFigure.classList.add("is-viewable");

      distanceEl.textContent = geoGameFormatDistance(distanceKm) + " away  ·  +" + pts.toLocaleString() + " pts";
      scoreEl.textContent = totalScore.toLocaleString() + " pts";
      mapHint.classList.add("is-hidden");
      guessBtn.hidden = true;
      nextBtn.hidden = false;
      nextBtn.textContent = (roundIndex + 1 >= rounds.length) ? "See results" : "Next photo";
    }

    function nextRound() {
      if (roundIndex + 1 >= rounds.length) {
        endGame();
        return;
      }
      roundIndex++;
      startRound();
    }

    function endGame() {
      var max = rounds.length * GEO_GAME_MAX_PTS;
      var best = geoGameGetHighScore();
      if (best === null || totalScore > best) {
        geoGameSetHighScore(totalScore);
      }
      updateBestDisplay();
      root.querySelector(".geo-game__board").hidden = true;
      finalText.textContent = "You scored " + totalScore.toLocaleString() +
        " out of " + max.toLocaleString() + " points across " + rounds.length + " photos.";
      finalEl.hidden = false;
    }

    function restart() {
      rounds = geoGameShuffle(allPoints).slice(0, Math.min(GEO_GAME_ROUNDS, allPoints.length));
      roundIndex = 0;
      totalScore = 0;
      finalEl.hidden = true;
      root.querySelector(".geo-game__board").hidden = false;
      map.invalidateSize();
      startRound();
    }

    map.on("click", function (e) {
      if (settled) {
        return;
      }
      guessLatLng = e.latlng;
      if (!guessMarker) {
        guessMarker = L.marker(e.latlng, {
          icon: geoGamePinIcon("guess"),
          draggable: true
        }).addTo(map);
        guessMarker.on("dragend", function (ev) {
          guessLatLng = ev.target.getLatLng();
        });
      } else {
        guessMarker.setLatLng(e.latlng);
      }
      guessBtn.disabled = false;
      mapHint.classList.add("is-hidden");
    });

    guessBtn.addEventListener("click", submitGuess);
    nextBtn.addEventListener("click", nextRound);
    replayBtn.addEventListener("click", restart);

    startRound();
    // Leaflet needs a size recalculation once the container is laid out.
    setTimeout(function () { map.invalidateSize(); }, 0);
  });
}

// Swap the basemap style when the theme toggle flips (alongside the other
// redraw hooks in toggleTheme()).
function redrawGeoGame() {
  if (!geoGameMapInstance) {
    return;
  }
  var tileConfig = photoMapTileConfig();
  if (geoGameTileLayer) {
    geoGameMapInstance.removeLayer(geoGameTileLayer);
  }
  geoGameTileLayer = L.tileLayer(tileConfig.url, {
    attribution: tileConfig.attribution,
    subdomains: "abcd",
    maxZoom: 19
  }).addTo(geoGameMapInstance);
}

/* ==========================================================================
   Read-more toggle for long research/teaching card descriptions
   ========================================================================== */

// Only these card blocks get the read-more treatment; each follows the same
// BEM shape (`{block}__title`, `{block}__meta`, `{block}__description`).
var READ_MORE_BLOCKS = ["research-item", "teaching-item"];
var READ_MORE_LINES = 4; // collapsed preview height, in lines of description text
var readMoreIdSeq = 0;

function initReadMore() {
  var cardSelector = READ_MORE_BLOCKS.map(function (block) { return "." + block; }).join(", ");

  document.querySelectorAll(cardSelector).forEach(function (card) {
    if (card.dataset.readMoreInit) {
      return;
    }

    var blockName = READ_MORE_BLOCKS.filter(function (block) {
      return card.classList.contains(block);
    })[0];
    var title = card.querySelector("." + blockName + "__title");
    var meta = card.querySelector("." + blockName + "__meta");
    var description = card.querySelector("." + blockName + "__description");
    if (!title || !description) {
      return;
    }

    // A description in a panel that's still `display: none` (e.g. the
    // inactive research tab) measures scrollHeight 0. Leave it unclaimed so
    // this re-runs once its panel is actually shown, instead of wrongly
    // deciding it never needs clamping.
    if (description.scrollHeight === 0) {
      return;
    }

    card.dataset.readMoreInit = "1";

    // scrollHeight reflects the full content height regardless of any clamp,
    // so this measures the natural (unclamped) height to see if it overflows.
    var lineHeight = parseFloat(window.getComputedStyle(description).lineHeight) || 0;
    var collapsedHeight = lineHeight * READ_MORE_LINES;
    var needsClamp = !!collapsedHeight && description.scrollHeight > collapsedHeight + lineHeight;

    var descriptionId = description.id || ("read-more-description-" + (++readMoreIdSeq));
    description.id = descriptionId;

    if (needsClamp) {
      description.classList.add("read-more", "is-collapsed");
      description.style.maxHeight = collapsedHeight + "px";
    }

    // Every card gets the toggle, even short ones — the chevron just won't
    // do anything to the description if there's nothing to clamp.
    // Wrap the title + meta together into one accessible toggle: a div acting
    // as a button (headings aren't valid <button> content), spanning the full
    // card width, that expands/collapses the description next to it.
    // Chevron always starts pointing down, whether or not there's anything to
    // clamp, so the resting state looks the same across every card.
    var header = document.createElement("div");
    header.className = "read-more-header";
    header.setAttribute("role", "button");
    header.tabIndex = 0;
    header.setAttribute("aria-expanded", "false");
    header.setAttribute("aria-controls", descriptionId);

    var headerText = document.createElement("div");
    headerText.className = "read-more-header__text";

    var chevron = document.createElement("span");
    chevron.className = "read-more-header__chevron";
    chevron.setAttribute("aria-hidden", "true");
    chevron.innerHTML =
      '<svg viewBox="0 0 16 10" fill="none"><path d="M1.5 1.5L8 8L14.5 1.5" ' +
      'stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    title.parentNode.insertBefore(header, title);
    headerText.appendChild(title);
    if (meta) {
      headerText.appendChild(meta);
    }
    header.appendChild(headerText);
    header.appendChild(chevron);

    function toggleExpanded() {
      var expanded = header.getAttribute("aria-expanded") === "true";
      header.setAttribute("aria-expanded", expanded ? "false" : "true");

      if (!needsClamp) {
        return; // nothing to clamp; the chevron just flips for feel
      }

      if (expanded) {
        description.style.maxHeight = collapsedHeight + "px";
        description.classList.add("is-collapsed");
      } else {
        description.style.maxHeight = description.scrollHeight + "px";
        description.classList.remove("is-collapsed");
      }
    }

    header.addEventListener("click", toggleExpanded);
    header.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
        e.preventDefault();
        toggleExpanded();
      }
    });
  });
}

/* ==========================================================================
   Sticky footer
   ========================================================================== */

function bumpIt() {
  $("body").css("padding-bottom", "0");
  $("body").css("margin-bottom", $(".page__footer").outerHeight(true));
}

/* ==========================================================================
   Per-page initialization — run on first load and again after every
   in-page (Swup) navigation. Kept idempotent so repeated calls are safe.
   ========================================================================== */

function initPage() {
  initResearchTabs();
  initPhotoLightbox();
  initPhotoMap();
  initGeoGame();
  initReadMore();
  renderMath();
  renderPlotly();
  renderMermaid();
  bumpIt();
}

// Exposed so the Swup navigation layer can re-run page setup after a swap.
window.AP = {
  initPage: initPage,
  redrawPlotly: redrawPlotly,
  setTheme: setTheme
};

/* ==========================================================================
   Actions that should occur when the page has been fully loaded
   ========================================================================== */

$(document).ready(function () {
  // SCSS SETTINGS - These should be the same as the settings in the relevant files
  const scssLarge = 925;          // pixels, from /_sass/_themes.scss
  const scssMastheadHeight = 70;  // pixels, from the current theme (e.g., /_sass/theme/_default.scss)

  // If the user hasn't explicitly chosen a theme, this keeps whatever the
  // server already rendered (DEFAULT_THEME) in sync with the toggle icon.
  setTheme();

  // Enable the theme toggle (the masthead persists across Swup navigations,
  // so this only needs to be bound once).
  $('#theme-toggle').on('click', toggleTheme);

  // Enable the sticky footer
  $(window).resize(function () {
    didResize = true;
  });
  setInterval(function () {
    if (didResize) {
      didResize = false;
      bumpIt();
    }}, 250);
  var didResize = false;

  // Follow menu drop down (the sidebar persists across Swup navigations, so
  // this is bound once).
  $(document).on("click", ".author__urls-wrapper button", function () {
    $(".author__urls").fadeToggle("fast", function () { });
    $(".author__urls-wrapper button").toggleClass("open");
  });

  // Restore the follow menu if toggled on a window resize
  jQuery(window).on('resize', function () {
    if ($('.author__urls.social-icons').css('display') == 'none' && $(window).width() >= scssLarge) {
      $(".author__urls").css('display', 'block')
    }
  });

  // First-load page setup (research tabs, Plotly, Mermaid, footer height).
  initPage();
});

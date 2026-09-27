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
   Goo toggle -- fluid "metaball" pill switch (research tabs, /photos/)
   ========================================================================== */

// Sets up one .goo-toggle bar (see _goo-toggle.scss). onSelect(btn) runs each
// time a button becomes the active one, as the pill starts moving to it.
function initGooToggle(wrap, onSelect) {
  if (!wrap || wrap.dataset.gooInit) {
    return;
  }
  var tabs = wrap.querySelectorAll('.goo-toggle__btn');
  var thumb = wrap.querySelector('.goo-toggle__thumb');
  var echo = wrap.querySelector('.goo-toggle__thumb-echo');
  if (!tabs.length) {
    return;
  }
  wrap.dataset.gooInit = '1';

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

  function select(btn) {
    tabs.forEach(function (t) {
      var on = t === btn;
      t.classList.toggle('is-active', on);
      if (t.hasAttribute('aria-pressed')) {
        t.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
    });
    moveThumb(btn, true);
    onSelect(btn);
  }

  // With only two options this behaves as a single fluid toggle: a click
  // anywhere in the bar (including the gaps and the already-active option)
  // flips to the other option, not just clicks on the inactive button.
  wrap.addEventListener('click', function (e) {
    var activeBtn = wrap.querySelector('.goo-toggle__btn.is-active');
    var clickedBtn = e.target.closest('.goo-toggle__btn');
    var target = (clickedBtn && clickedBtn !== activeBtn) ? clickedBtn : null;

    if (!target) {
      var idx = Array.prototype.indexOf.call(tabs, activeBtn);
      target = tabs[(idx + 1) % tabs.length];
    }

    select(target);
  });

  // Keep the pill aligned if the bar reflows (font load, resize).
  wrap.__reposition = function () {
    moveThumb(wrap.querySelector('.goo-toggle__btn.is-active'), false);
  };

  wrap.__reposition();
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(wrap.__reposition);
  }
}

// One global resize listener repositions whichever goo toggles are present.
window.addEventListener('resize', function () {
  document.querySelectorAll('.goo-toggle').forEach(function (w) {
    if (w.__reposition) {
      w.__reposition();
    }
  });
});

/* ==========================================================================
   Research tabs (see /research/)
   ========================================================================== */

function initResearchTabs() {
  initGooToggle(document.querySelector('.research-tabs'), function (btn) {
    var key = btn.getAttribute('data-panel');
    var current = document.querySelector('.research-panel.is-active');
    var next = document.getElementById('panel-' + key);

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
  });
}

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
  var lastTouchTime = 0; // see the touch gestures below

  function resetTouchZoom(animate) {
    tz = { s: 1, x: 0, y: 0 };
    applyTouchZoom(animate);
  }
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var locationHref = null;

  // "3 / 46" in the corner, and a filmstrip of the whole gallery along the
  // bottom, kept centred on the current photo so its neighbours sit either
  // side. Both are built here rather than in each page's markup, and hidden
  // for single-photo views (the geo-game) -- see .is-single in _photo-grid.scss.
  var counter = null;
  var strip = null;
  var stripThumbs = [];
  if (items.length > 1) {
    counter = document.createElement("span");
    counter.className = "lightbox-overlay__counter";
    overlay.appendChild(counter);

    strip = document.createElement("div");
    strip.className = "lightbox-overlay__strip";
    items.forEach(function (item, i) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "lightbox-overlay__strip-thumb";
      var caption = item.getAttribute("data-caption");
      btn.setAttribute("aria-label", "Show photo " + (i + 1) + (caption ? ": " + caption : ""));
      var img = document.createElement("img");
      var gridImg = item.querySelector("img");
      img.src = gridImg ? gridImg.getAttribute("src") : item.getAttribute("href");
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      btn.appendChild(img);
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        showPhoto(i);
      });
      strip.appendChild(btn);
      stripThumbs.push(btn);
    });
    overlay.appendChild(strip);
    overlay.classList.add("has-strip");
  }

  function updateStrip(smooth) {
    if (counter) {
      counter.textContent = (currentIndex + 1) + " / " + items.length;
    }
    if (!strip) {
      return;
    }
    stripThumbs.forEach(function (btn, i) {
      var on = i === currentIndex;
      btn.classList.toggle("is-current", on);
      if (on) {
        btn.setAttribute("aria-current", "true");
      } else {
        btn.removeAttribute("aria-current");
      }
    });
    var cur = stripThumbs[currentIndex];
    strip.scrollTo({
      left: cur.offsetLeft + cur.offsetWidth / 2 - strip.clientWidth / 2,
      behavior: smooth && !reduceMotion ? "smooth" : "auto"
    });
  }

  // Warm the cache for the photos either side, so next/prev (arrow keys,
  // swipes, the strip) show up without waiting on the network.
  function preload(index) {
    if (items.length > 1) {
      new Image().src = items[(index + items.length) % items.length].getAttribute("href");
    }
  }

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
    updateLocationLink(item.getAttribute("href"));
  }

  // A photo with a pin on this page's Photo Map gets its location as a link:
  // it closes the lightbox and flies the map to the pin (see initPhotoMap).
  function updateLocationLink(href) {
    var mapEl = document.getElementById("photo-map");
    locationHref = href && mapEl && mapEl.__mapHrefs && mapEl.__mapHrefs[href] ? href : null;
    var on = !!locationHref && !!captionLocation.textContent;
    captionLocation.classList.toggle("is-link", on);
    if (on) {
      captionLocation.setAttribute("role", "button");
      captionLocation.setAttribute("tabindex", "0");
      captionLocation.setAttribute("title", "Show on the photo map");
    } else {
      captionLocation.removeAttribute("role");
      captionLocation.removeAttribute("tabindex");
      captionLocation.removeAttribute("title");
    }
  }

  function showOnMap(e) {
    if (!locationHref) {
      return;
    }
    e.stopPropagation();
    var href = locationHref;
    var mapEl = document.getElementById("photo-map");
    closeLightbox();
    mapEl.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
    // Fly once the scroll has (roughly) landed, so the flight is seen.
    if (mapEl.__showPhoto) {
      window.setTimeout(function () { mapEl.__showPhoto(href); }, reduceMotion ? 0 : 500);
    }
  }

  captionLocation.addEventListener("click", showOnMap);
  captionLocation.addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      showOnMap(e);
    }
  });

  function showPhoto(index) {
    if (!items.length) {
      return;
    }
    var wasOpen = overlay.classList.contains("is-active") && currentIndex !== -1;
    currentIndex = (index + items.length) % items.length;
    var item = items[currentIndex];
    prevBtn.hidden = false;
    nextBtn.hidden = false;
    stopZoom();
    resetTouchZoom(false);
    overlayImg.src = item.getAttribute("href");
    updateCaption(item);
    overlay.classList.remove("is-single");
    overlay.classList.add("is-active");
    document.body.classList.add("lightbox-open");
    // Glide along the strip when stepping through; jump straight there on open.
    updateStrip(wasOpen);
    preload(currentIndex + 1);
    preload(currentIndex - 1);
  }

  // Opens a single photo outside the gallery's item list -- used by callers
  // (like the geo-game) that show one photo at a time with no set to browse
  // through. Prev/next are hidden since there's nothing to navigate to.
  function showSinglePhoto(src, caption, location, date) {
    resetTouchZoom(false);
    currentIndex = -1;
    prevBtn.hidden = true;
    nextBtn.hidden = true;
    overlayImg.src = src;
    setCaption(caption, location, date);
    updateLocationLink(null);
    overlay.classList.add("is-single");
    overlay.classList.add("is-active");
    document.body.classList.add("lightbox-open");
  }

  function closeLightbox() {
    resetTouchZoom(false);
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
    overlay.classList.remove("is-zoomed");
    zoomRect = null;
  }

  items.forEach(function (item, index) {
    item.addEventListener("click", function (e) {
      e.preventDefault();
      showPhoto(index);
    });
  });

  // Featured reel tiles (top of /photos/) share their grid tile's href, so
  // they open that photo's slot in the main sequence -- favourites aren't
  // counted twice in the counter and filmstrip.
  var hrefs = items.map(function (item) { return item.getAttribute("href"); });
  document.querySelectorAll(".photo-feature__item").forEach(function (tile) {
    tile.addEventListener("click", function (e) {
      var index = hrefs.indexOf(tile.getAttribute("href"));
      if (index !== -1) {
        e.preventDefault();
        showPhoto(index);
      }
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

  // Where the press began. Dragging to select caption text and letting go
  // over the backdrop fires a click on the backdrop, so a click only counts
  // as clicking off if the press started there too. Captured, since the
  // photo's own mousedown handler stops propagation.
  var pressTarget = null;
  overlay.addEventListener("mousedown", function (e) {
    pressTarget = e.target;
  }, true);

  overlay.addEventListener("click", function (e) {
    // The backdrop, or the empty space either side of the filmstrip (which
    // spans the full width), counts as clicking off the photo -- with a
    // mouse only. On touch screens the photo rarely fills the screen, so a
    // stray tap closed it far too easily; there it's the close button or a
    // swipe down instead (see the touch gestures below).
    if (Date.now() - lastTouchTime < 800) {
      return;
    }
    var offPhoto = e.target === overlay || (strip && e.target === strip);
    if (offPhoto && e.target === pressTarget) {
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
    // Clears the caption and controls off the zoomed photo (see _photo-grid.scss).
    overlay.classList.add("is-zoomed");
  });

  /* ---------- Touch: pinch/double-tap zoom, pan, swipe ---------- */

  // The photo's own zoom on touch screens, as a translate + scale about its
  // top-left corner (the page itself can't pinch-zoom -- touch-action: none on
  // the overlay). Swipes step through photos (or close, downwards) only while
  // unzoomed; zoomed, one finger pans instead.
  var tz = { s: 1, x: 0, y: 0 };
  var gesture = null;
  var lastTap = null;

  var touchZoomTimer = null;
  function applyTouchZoom(animate) {
    window.clearTimeout(touchZoomTimer);
    if (tz.s === 1 && !animate) {
      // Back to the stylesheet's own transform/transition, which the
      // desktop press-and-hold zoom relies on.
      overlayImg.style.transition = "";
      overlayImg.style.transformOrigin = "";
      overlayImg.style.transform = "";
      overlay.classList.remove("is-zoomed");
      return;
    }
    overlayImg.style.transition = animate ? "transform 0.25s ease" : "none";
    overlayImg.style.transformOrigin = "0 0";
    overlayImg.style.transform = tz.s === 1 ? "translate(0, 0) scale(1)" :
      "translate(" + tz.x + "px, " + tz.y + "px) scale(" + tz.s + ")";
    overlay.classList.toggle("is-zoomed", tz.s > 1);
    if (tz.s === 1) {
      touchZoomTimer = window.setTimeout(function () { applyTouchZoom(false); }, 260);
    }
  }

  // The photo's unzoomed box on screen (its transform is only a translation
  // of the top-left corner plus a scale, so this can be read back any time).
  function baseBox() {
    var r = overlayImg.getBoundingClientRect();
    return { left: r.left - tz.x, top: r.top - tz.y, width: r.width / tz.s, height: r.height / tz.s };
  }

  // Zoom to scale s, keeping the photo point that was under (fromX, fromY)
  // at (toX, toY) -- so a pinch can pan as it zooms.
  function zoomAbout(box, s0, x0, y0, s, fromX, fromY, toX, toY) {
    var localX = (fromX - box.left - x0) / s0;
    var localY = (fromY - box.top - y0) / s0;
    tz.s = s;
    // Keep the photo covering its own box, so it can't be dragged away.
    tz.x = Math.min(0, Math.max(box.width * (1 - s), toX - box.left - localX * s));
    tz.y = Math.min(0, Math.max(box.height * (1 - s), toY - box.top - localY * s));
  }

  function touchPoint(t) {
    return { x: t.clientX, y: t.clientY };
  }

  overlay.addEventListener("touchstart", function (e) {
    lastTouchTime = Date.now();
    // Buttons, the location link and the filmstrip (which scrolls natively)
    // keep their own taps.
    if (e.target.closest("button, [role=button], .lightbox-overlay__strip, .lightbox-overlay__close, .lightbox-overlay__prev, .lightbox-overlay__next")) {
      gesture = null;
      return;
    }
    e.preventDefault();
    if (e.touches.length === 2) {
      var a = touchPoint(e.touches[0]), b = touchPoint(e.touches[1]);
      gesture = {
        type: "pinch",
        box: baseBox(),
        s0: tz.s, x0: tz.x, y0: tz.y,
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      };
    } else if (e.touches.length === 1 && !(gesture && gesture.type === "pinch")) {
      var p = touchPoint(e.touches[0]);
      gesture = { type: tz.s > 1 ? "pan" : "swipe", start: p, x0: tz.x, y0: tz.y, box: baseBox() };
    }
  }, { passive: false });

  overlay.addEventListener("touchmove", function (e) {
    if (!gesture) {
      return;
    }
    e.preventDefault();
    if (gesture.type === "pinch" && e.touches.length === 2) {
      var a = touchPoint(e.touches[0]), b = touchPoint(e.touches[1]);
      var s = Math.min(4, Math.max(1, gesture.s0 * Math.hypot(a.x - b.x, a.y - b.y) / gesture.dist));
      zoomAbout(gesture.box, gesture.s0, gesture.x0, gesture.y0, s,
        gesture.mid.x, gesture.mid.y, (a.x + b.x) / 2, (a.y + b.y) / 2);
      applyTouchZoom(false);
    } else if (gesture.type === "pan" && e.touches.length === 1) {
      var p = touchPoint(e.touches[0]);
      tz.x = Math.min(0, Math.max(gesture.box.width * (1 - tz.s), gesture.x0 + p.x - gesture.start.x));
      tz.y = Math.min(0, Math.max(gesture.box.height * (1 - tz.s), gesture.y0 + p.y - gesture.start.y));
      applyTouchZoom(false);
    }
  }, { passive: false });

  overlay.addEventListener("touchend", function (e) {
    if (!gesture) {
      return;
    }
    if (gesture.type === "pinch") {
      if (e.touches.length > 0) {
        return; // a finger is still down: wait for it, and don't count it as a swipe
      }
      if (tz.s < 1.05) {
        resetTouchZoom(true);
      }
      gesture = null;
      return;
    }
    var end = touchPoint(e.changedTouches[0]);
    var dx = end.x - gesture.start.x;
    var dy = end.y - gesture.start.y;
    var type = gesture.type;
    var box = gesture.box;
    gesture = null;

    if (Math.hypot(dx, dy) <= 10) {
      // Double-tap toggles a 2.5x zoom centred on the tapped spot.
      var now = Date.now();
      if (lastTap && now - lastTap.time < 300 && Math.hypot(end.x - lastTap.x, end.y - lastTap.y) < 30) {
        lastTap = null;
        if (tz.s > 1) {
          resetTouchZoom(true);
        } else if (e.target === overlayImg) {
          zoomAbout(box, 1, 0, 0, 2.5, end.x, end.y, end.x, end.y);
          applyTouchZoom(true);
        }
      } else {
        lastTap = { time: now, x: end.x, y: end.y };
      }
      return;
    }
    if (type !== "swipe") {
      return;
    }
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) && currentIndex !== -1) {
      showPhoto(currentIndex + (dx < 0 ? 1 : -1));
    } else if (dy > 80 && dy > Math.abs(dx)) {
      closeLightbox(); // swipe down to close
    }
  });

  overlay.addEventListener("touchcancel", function () {
    gesture = null;
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
      // Single-photo views (index -1) have nothing to step through.
      if (c.getIndex() === -1) { return; }
      if (e.key === "ArrowRight") { c.showPhoto(c.getIndex() + 1); }
      if (e.key === "ArrowLeft") { c.showPhoto(c.getIndex() - 1); }
    });
  }
}

/* ==========================================================================
   Featured reel: edge buttons + smooth wheel scrolling (top of /photos/)
   ========================================================================== */

function initPhotoFeature() {
  var section = document.querySelector(".photo-feature");
  if (!section || section.dataset.featureInit) {
    return;
  }
  section.dataset.featureInit = "1";

  var reel = section.querySelector(".photo-feature__reel");
  var prev = section.querySelector('.photo-feature__edge[data-dir="-1"]');
  var next = section.querySelector('.photo-feature__edge[data-dir="1"]');
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Where a glide is heading (null when idle). Wheel ticks and edge clicks
  // both add to it, so rapid input accumulates into one smooth, eased motion
  // instead of a series of jumps.
  var target = null;
  var frame = 0;

  function maxScroll() {
    return reel.scrollWidth - reel.clientWidth;
  }

  function position() {
    return target === null ? reel.scrollLeft : target;
  }

  function stopGlide() {
    if (frame) {
      cancelAnimationFrame(frame);
    }
    frame = 0;
    target = null;
  }

  function step() {
    var diff = target - reel.scrollLeft;
    var move = diff * 0.18;
    var before = reel.scrollLeft;
    // Finish once within a pixel -- or if the reel stopped moving (a bound, or
    // a browser that rounds scrollLeft), so the loop can never spin forever.
    if (Math.abs(move) < 1) {
      reel.scrollLeft = target;
      stopGlide();
      return;
    }
    reel.scrollLeft += move;
    if (reel.scrollLeft === before) {
      stopGlide();
      return;
    }
    frame = requestAnimationFrame(step);
  }

  function glide(delta) {
    target = Math.max(0, Math.min(maxScroll(), position() + delta));
    if (reduceMotion) {
      reel.scrollLeft = target;
      target = null;
      return;
    }
    if (!frame) {
      frame = requestAnimationFrame(step);
    }
  }

  // The edges only show when the reel overflows, and fade out at either end.
  function update() {
    var max = maxScroll();
    var at = position();
    section.classList.toggle("is-scrollable", max > 1);
    prev.disabled = at <= 1;
    next.disabled = at >= max - 1;
  }

  [prev, next].forEach(function (btn) {
    btn.addEventListener("click", function () {
      glide(Number(btn.dataset.dir) * reel.clientWidth * 0.8);
      update();
    });
  });

  // A vertical mouse wheel scrolls the reel sideways. At either end it falls
  // through to the page, so the reel never traps scrolling. Horizontal
  // trackpad swipes (deltaX) and pinch-zoom (ctrlKey) are left to the browser.
  reel.addEventListener("wheel", function (e) {
    if (e.ctrlKey || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) {
      return;
    }
    var delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? reel.clientWidth : 1);
    var at = position();
    if ((delta < 0 && at <= 0) || (delta > 0 && at >= maxScroll() - 1)) {
      return;
    }
    e.preventDefault();
    glide(delta);
    update();
  }, { passive: false });

  // Touch or the scrollbar take over from any glide in progress.
  reel.addEventListener("pointerdown", stopGlide);
  reel.addEventListener("touchstart", stopGlide, { passive: true });

  reel.addEventListener("scroll", update, { passive: true });
  // Observes the reel itself (not window) so nothing outlives a Swup swap.
  if (window.ResizeObserver) {
    new ResizeObserver(update).observe(reel);
  }
  // Tile widths come from the photos, so they aren't known until each loads.
  reel.querySelectorAll("img").forEach(function (img) {
    if (!img.complete) {
      img.addEventListener("load", update);
    }
  });
  update();
}

/* ==========================================================================
   Photo location map (used on /photos/)
   ========================================================================== */

const LEAFLET_JS_URL = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
const LEAFLET_CSS_URL = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
// Vector basemap renderer + the official bridge that shows it as a Leaflet
// layer, so markers, popups and the geo-game stay plain Leaflet.
const MAPLIBRE_JS_URL = "https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.js";
const MAPLIBRE_CSS_URL = "https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.css";
const MAPLIBRE_LEAFLET_URL = "https://unpkg.com/@maplibre/maplibre-gl-leaflet@0.1.4/leaflet-maplibre-gl.js";
const MAPLIBRE_RTL_URL = "https://unpkg.com/@mapbox/mapbox-gl-rtl-text@0.3.0/dist/mapbox-gl-rtl-text.js";

let leafletLoading = false;
let photoMapInstance = null;
var PHOTO_MAP_FOCUS_ZOOM = 12; // city-level: where the location link lands
let photoMapTileLayer = null;

// Two looks for the dark theme, kept side by side to compare -- flip this:
//   "mirrored" -- Positron recoloured as the inverse of the light theme
//                 (darkenMapStyle): same label fonts, sizes and weighting,
//                 light text on dark.
//   "classic"  -- OpenFreeMap's own Dark style: small, dim, all-caps labels.
var MAP_DARK_PRESET = "mirrored";

// OpenFreeMap's Positron / Dark vector styles (free, no API key), which label
// places in their own language ("Schweiz/Suisse/Svizzera", "Venezia"; non-Latin
// names also get a transliteration), with Esri's hillshade laid under them for
// a little topography. CARTO's free raster basemaps now need an API key.
function photoMapBasemap() {
  var dark = determineComputedTheme() === "dark";
  var mirrored = dark && MAP_DARK_PRESET === "mirrored";
  if (!L.maplibreGL) {
    return esriBasemap(dark); // no WebGL, or the renderer failed to load
  }
  var layer = L.maplibreGL({
    style: "https://tiles.openfreemap.org/styles/" + (dark && !mirrored ? "dark" : "positron"),
    // The bridge shows this in Leaflet's own credits line.
    attributionControl: {
      customAttribution:
        '<a href="https://openfreemap.org/">OpenFreeMap</a> ' +
        '&copy; <a href="https://www.openmaptiles.org/">OpenMapTiles</a> ' +
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, ' +
        'relief &copy; <a href="https://www.esri.com/">Esri</a>'
    }
  });
  layer.once("add", function () {
    var gl = layer.getMaplibreMap();
    function customise() {
      nativeMapLabels(gl);
      addMapRelief(gl, dark);
      if (!dark) {
        // Positron's sea is a heavy mid-grey; lift it towards the page.
        gl.setPaintProperty("water", "fill-color", "rgb(214, 220, 222)");
      } else if (mirrored) {
        darkenMapStyle(gl);
      } else {
        // The Dark style paints ice near-black, which reads as holes in the
        // relief-shaded land (Greenland, Antarctica); let the land show.
        ["landcover_ice_shelf", "landcover_glacier"].forEach(function (id) {
          if (gl.getLayer(id)) {
            gl.setPaintProperty(id, "fill-opacity", 0);
          }
        });
      }
    }
    if (gl.isStyleLoaded()) {
      customise();
    } else {
      gl.once("style.load", customise);
    }
  });
  return layer;
}

// The "mirrored" dark preset (see MAP_DARK_PRESET). Dark palette for
// Positron, layer by layer: land a little lighter than the sea, roads and
// borders as soft greys, and labels as the inverse of Positron's -- its black
// place names on a white halo become near-white on a dark one, its dark
// greys light greys, its mid-grey road names mid-grey. Water names drop
// Positron's blue for a neutral grey, so every label reads as one family.
function darkenMapStyle(gl) {
  gl.getStyle().layers.forEach(function (l) {
    var id = l.id;
    function paint(prop, value) {
      gl.setPaintProperty(id, prop, value);
    }
    if (l.type === "background") {
      paint("background-color", "#1c1c1e");
    } else if (l.type === "fill") {
      if (id === "water") {
        paint("fill-color", "#111214");
      } else if (/building/.test(id)) {
        paint("fill-color", "#26262a");
        paint("fill-outline-color", "#2e2e33");
      } else if (/pier/.test(id)) {
        paint("fill-color", "#1c1c1e");
      } else {
        // Parks, landcover, landuse, ice, airports: a faint light tint rather
        // than a solid fill, so towns and woods read slightly lighter than the
        // land (as in Positron) and the relief still shows through.
        paint("fill-color", "rgba(255, 255, 255, 0.05)");
      }
    } else if (l.type === "line") {
      if (/waterway/.test(id)) {
        paint("line-color", "#111214");
      } else if (/boundary/.test(id)) {
        paint("line-color", "#5a5a61");
      } else if (/pier|dashline/.test(id)) {
        paint("line-color", "#1c1c1e");
      } else if (/casing/.test(id)) {
        paint("line-color", "#2b2b30");
      } else if (/subtle/.test(id)) {
        paint("line-color", "rgba(90, 90, 98, 0.5)");
      } else {
        paint("line-color", "#58585f"); // roads, railways, runways
      }
    } else if (l.type === "symbol") {
      if (/shield/.test(id)) {
        // Road-number badges are light sprites; they'd glare on dark.
        gl.setLayoutProperty(id, "visibility", "none");
        return;
      }
      if (!l.layout || !l.layout["text-field"]) {
        return;
      }
      paint("text-halo-color", "rgba(24, 24, 26, 0.95)");
      paint("text-color",
        /country|city|town|village/.test(id) ? "#ededed" : // Positron #000
        /state|other/.test(id) ? "#bdbdbd" :               // Positron #333
        /^water/.test(id) ? "#a9a9a9" :                    // Positron's blue, neutralised
        "#9a9a9a");                                        // roads, airports: Positron #666
    }
  });
}

// The styles label with `name:latin` (plus the native form for non-Latin
// scripts), which for countries is the English name. Use each place's own
// `name` instead: Türkiye, México, Россия, 日本.
function nativeMapLabels(gl) {
  gl.getStyle().layers.forEach(function (l) {
    var field = l.layout && l.layout["text-field"];
    if (field && JSON.stringify(field).indexOf("name:latin") !== -1) {
      gl.setLayoutProperty(l.id, "text-field", ["coalesce", ["get", "name"], ["get", "name:latin"]]);
    }
  });
}

// Esri's hillshade, just above the style's flat land colour and beneath parks,
// water, roads and labels, so relief reads as soft shading and the sea stays
// clean. Kept faint so the photo pins remain the subject.
function addMapRelief(gl, dark) {
  var layers = gl.getStyle().layers;
  var background = layers.filter(function (l) { return l.type === "background"; })[0];
  var above = layers[layers.indexOf(background) + 1];
  gl.addSource("relief", {
    type: "raster",
    tileSize: 256,
    maxzoom: 16,
    tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade" +
      (dark ? "_Dark" : "") + "/MapServer/tile/{z}/{y}/{x}"]
  });
  gl.addLayer({
    id: "relief",
    type: "raster",
    source: "relief",
    paint: { "raster-opacity": dark ? 0.45 : 0.35, "raster-fade-duration": 200 }
  }, above ? above.id : undefined);
}

// Fallback: Esri's Light/Dark Gray Canvas raster basemaps (English labels).
// The base tiles carry land/water and country names; a separate transparent
// reference layer adds city labels on top.
function esriBasemap(dark) {
  var shade = dark ? "Dark" : "Light";
  var root = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_" + shade + "_Gray_";
  var opts = { maxNativeZoom: 16, maxZoom: 19 };
  return L.layerGroup([
    L.tileLayer(root + "Base/MapServer/tile/{z}/{y}/{x}", L.extend({
      attribution:
        'Tiles &copy; <a href="https://www.esri.com/">Esri</a>, HERE, Garmin, ' +
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }, opts)),
    L.tileLayer(root + "Reference/MapServer/tile/{z}/{y}/{x}", opts)
  ]);
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
  // window.L appears before the vector renderer has finished loading, so
  // only skip ahead once the whole chain is done.
  if (window.L && !leafletLoading) {
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
  function done() {
    leafletLoading = false;
    document.dispatchEvent(new Event("leaflet:loaded"));
    callback();
  }
  loadMapScript(LEAFLET_JS_URL, function (ok) {
    if (!ok) {
      leafletLoading = false;
      return;
    }
    // The vector basemap needs WebGL; without it (or if a script fails)
    // photoMapBasemap() falls back to Esri's raster tiles.
    if (!window.WebGLRenderingContext) {
      done();
      return;
    }
    if (!document.querySelector('link[href="' + MAPLIBRE_CSS_URL + '"]')) {
      var glCss = document.createElement("link");
      glCss.rel = "stylesheet";
      glCss.href = MAPLIBRE_CSS_URL;
      document.head.appendChild(glCss);
    }
    loadMapScript(MAPLIBRE_JS_URL, function (ok) {
      if (!ok) {
        done();
        return;
      }
      // Arabic/Hebrew labels need shaping; fetched only if one is on screen.
      try {
        maplibregl.setRTLTextPlugin(MAPLIBRE_RTL_URL, true);
      } catch (e) { /* already set by an earlier page */ }
      loadMapScript(MAPLIBRE_LEAFLET_URL, done);
    });
  });
}

// Calls back with true once the script has run, or false if it failed.
function loadMapScript(src, callback) {
  var script = document.createElement("script");
  script.src = src;
  script.async = true;
  script.onload = function () { callback(true); };
  script.onerror = function () { callback(false); };
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

  // Which photos have a pin, known before Leaflet loads, so the lightbox can
  // offer its "show on the map" link straight away (see initPhotoLightbox).
  container.__mapHrefs = {};
  points.forEach(function (p) {
    container.__mapHrefs[p.full] = true;
  });

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
    // so only our Esri/OpenStreetMap credit line shows.
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

    photoMapTileLayer = photoMapBasemap().addTo(map);

    var bounds = [];
    var markers = {};
    points.forEach(function (p) {
      var marker = L.marker([p.lat, p.lng], { icon: photoMarkerIcon() }).addTo(map);
      markers[p.full] = marker;
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

    // Flies to one photo's pin and opens its popup -- used by the lightbox's
    // location link. Never zooms back out if already closer in.
    var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    container.__showPhoto = function (href) {
      var marker = markers[href];
      if (!marker) {
        return;
      }
      var zoom = Math.max(map.getZoom(), PHOTO_MAP_FOCUS_ZOOM);
      if (reduceMotion) {
        map.setView(marker.getLatLng(), zoom);
        marker.openPopup();
        return;
      }
      map.once("moveend", function () { marker.openPopup(); });
      map.flyTo(marker.getLatLng(), zoom, { duration: 1.2 });
    };
  });
}

// Swap the basemap style when the theme toggle flips (used alongside
// redrawPlotly() in toggleTheme()).
function redrawPhotoMap() {
  if (!photoMapInstance) {
    return;
  }
  if (photoMapTileLayer) {
    photoMapInstance.removeLayer(photoMapTileLayer);
  }
  photoMapTileLayer = photoMapBasemap().addTo(photoMapInstance);
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

    geoGameTileLayer = photoMapBasemap().addTo(map);

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
  if (geoGameTileLayer) {
    geoGameMapInstance.removeLayer(geoGameTileLayer);
  }
  geoGameTileLayer = photoMapBasemap().addTo(geoGameMapInstance);
}

/* ==========================================================================
   Chromatic Geography (bottom of /photos/)
   ========================================================================== */

// Draws one precomputed object: classical MDS of the pairwise 1-Wasserstein
// distances between the photos' Lab colour histograms (see
// scripts/chromatic_analysis.py). The map is modes 1-2, drawn at equal scale
// on both axes so on-screen distance stays proportional to the embedding.
// Nothing numerical happens here beyond layout.

function chromaEl(tag, className, text) {
  var el = document.createElement(tag);
  if (className) {
    el.className = className;
  }
  if (text != null) {
    el.textContent = text;
  }
  return el;
}

function chromaFileName(href) {
  var name = (href || "").split("/").pop();
  try {
    return decodeURIComponent(name);
  } catch (e) {
    return name;
  }
}

// A photo's top histogram colours as a conic gradient, arcs sized by weight
// (renormalized over the colours shown) -- the Colours view of the map.
// A round tick step (1, 2 or 5 times a power of ten) near `raw`.
function chromaNiceStep(raw) {
  var mag = Math.pow(10, Math.floor(Math.log10(raw)));
  var r = raw / mag;
  return (r < 1.5 ? 1 : r < 3.5 ? 2 : r < 7.5 ? 5 : 10) * mag;
}

function chromaSvg(parent, tag, attrs, text) {
  var el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  Object.keys(attrs).forEach(function (k) { el.setAttribute(k, attrs[k]); });
  if (text != null) {
    el.textContent = text;
  }
  parent.appendChild(el);
  return el;
}

function chromaRing(palette) {
  if (!palette || !palette.length) {
    return "";
  }
  var total = palette.reduce(function (s, c) { return s + c[1]; }, 0);
  var acc = 0;
  return "conic-gradient(" + palette.map(function (c) {
    var from = acc / total * 100;
    acc += c[1];
    return c[0] + " " + from.toFixed(2) + "% " + (acc / total * 100).toFixed(2) + "%";
  }).join(", ") + ")";
}

function initChromatic() {
  var root = document.getElementById("chromatic");
  if (!root || root.dataset.chromaInit) {
    return;
  }
  root.dataset.chromaInit = "1";
  initGooToggle(root.querySelector(".chroma__toggle"), function (btn) {
    root.classList.toggle("is-colours", btn.dataset.view === "colours");
  });
  var status = root.querySelector(".chroma__status");
  fetch(root.dataset.src)
    .then(function (res) {
      if (!res.ok) {
        throw new Error(res.status);
      }
      return res.json();
    })
    .then(function (data) { buildChromatic(root, data); })
    .catch(function () {
      status.textContent = "Couldn't load the colour analysis.";
    });
}

function buildChromatic(root, data) {
  var base = root.dataset.baseurl || "";
  var mapEl = root.querySelector(".chroma__map");
  var pointsEl = root.querySelector(".chroma__points");
  var svg = root.querySelector(".chroma__lines");
  var axesSvg = root.querySelector(".chroma__axes");
  var titlesSvg = root.querySelector(".chroma__axes--titles");
  var tip = root.querySelector(".chroma__tip");
  var panel = root.querySelector(".chroma__panel");
  // Optional: an instruction line that gives way to the neighbours on selection.
  var hint = root.querySelector(".chroma__hint");
  var selectedBox = root.querySelector(".chroma__selected");
  var selectedTitle = root.querySelector(".chroma__selected-title");
  var neighboursEl = root.querySelector(".chroma__neighbours");

  // Gallery items by filename, so photos open in the existing lightbox (with
  // prev/next through the gallery). Photos hidden from the gallery since the
  // analysis was last run are dropped rather than shown.
  var gridItems = {};
  document.querySelectorAll(".photo-grid__item").forEach(function (item) {
    gridItems[chromaFileName(item.getAttribute("href"))] = item;
  });
  var photos = data.photos.filter(function (p) { return gridItems[p.id]; });
  var byId = {};
  photos.forEach(function (p) { byId[p.id] = p; });
  if (photos.length < 3) {
    root.querySelector(".chroma__status").textContent = "The colour analysis is out of date.";
    return;
  }
  var missing = Object.keys(gridItems).filter(function (id) { return !byId[id]; }).length;
  var missingNote = hint || root.querySelector(".chroma__sub");
  if (missing && missingNote) {
    missingNote.textContent += " " + missing + (missing === 1 ? " newer photo isn't" : " newer photos aren't") +
      " on the map yet.";
  }

  function title(p) {
    return p.title || "Untitled";
  }

  function openPhoto(p) {
    gridItems[p.id].click();
  }

  function thumb(p, className) {
    var img = chromaEl("img", className);
    img.src = base + p.thumb;
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    return img;
  }

  /* ---------- Geography ---------- */

  var selected = null;
  var points = photos.map(function (p) {
    var btn = chromaEl("button", "chroma__pt");
    btn.type = "button";
    btn.style.setProperty("--c", p.average_hex);
    btn.style.setProperty("--mix", chromaRing(p.palette));
    btn.setAttribute("aria-label", title(p) + (p.location ? ", " + p.location : ""));
    btn.appendChild(thumb(p));
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (selected === p) {
        openPhoto(p);
      } else {
        select(p);
      }
    });
    btn.addEventListener("mouseenter", function () { showTip(p); });
    btn.addEventListener("mouseleave", hideTip);
    btn.addEventListener("focus", function () {
      if (btn.matches(":focus-visible")) {
        showTip(p);
      }
    });
    btn.addEventListener("blur", hideTip);
    pointsEl.appendChild(btn);
    p._pt = btn;
    return btn;
  });

  var xs = photos.map(function (p) { return p.x; });
  var ys = photos.map(function (p) { return p.y; });
  var xMin = Math.min.apply(null, xs), xMax = Math.max.apply(null, xs);
  var yMin = Math.min.apply(null, ys), yMax = Math.max.apply(null, ys);
  var lastWidth = 0;

  function layout() {
    var W = mapEl.clientWidth;
    if (!W || W === lastWidth) {
      return;
    }
    lastWidth = W;
    var size = W < 600 ? 30 : 44;
    var pad = size / 2 + 8;
    // Extra room at the positive ends (right, top) for the arrowheads.
    var padEnd = pad + 14;
    // Gutters (left, bottom) holding the tick labels, where no photo can cover them.
    var gl = 24, gb = 16;
    var plotW = W - gl;
    var rx = (xMax - xMin) || 1, ry = (yMax - yMin) || 1;
    var plotH = Math.round(Math.min(Math.max((plotW - pad - padEnd) * ry / rx + pad + padEnd, 300), 620));
    var H = plotH + gb;
    // One scale for both axes: the map may be letterboxed, never stretched.
    var s = Math.min((plotW - pad - padEnd) / rx, (plotH - pad - padEnd) / ry);
    var ox = gl + pad + (plotW - pad - padEnd - rx * s) / 2;
    var oy = padEnd + (plotH - pad - padEnd - ry * s) / 2;
    mapEl.style.height = H + "px";
    mapEl.style.setProperty("--pt", size + "px");
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    photos.forEach(function (p) {
      p._px = ox + (p.x - xMin) * s;
      p._py = oy + (yMax - p.y) * s; // mode 2 points up
      p._pt.style.left = p._px + "px";
      p._pt.style.top = p._py + "px";
    });
    drawAxes(W, H, gl, plotH, s, ox - xMin * s, oy + yMax * s);
    drawLines();
  }

  // The plane the embedding lives in. Classical MDS centres the photos, so the
  // axes cross at their centroid (x0, y0). Both axes share one tick step so the
  // equal scale stays visible; the units are those of the colour distance.
  // The plot spans [left, W] x [0, bottom]; tick labels sit in the gutters.
  function drawAxes(W, H, left, bottom, s, x0, y0) {
    [axesSvg, titlesSvg].forEach(function (el) {
      while (el.firstChild) {
        el.removeChild(el.firstChild);
      }
      el.setAttribute("viewBox", "0 0 " + W + " " + H);
    });
    var step = chromaNiceStep(Math.max(W, H) / s / 6);
    var minor = step / 4; // unlabelled guide lines, three between each pair of ticks
    var edge = 16; // keep ticks clear of the arrowheads and the plot's edges
    var k, v, px;

    for (k = Math.ceil((left + edge - x0) / s / minor); (px = x0 + k * minor * s) <= W - edge - 14; k++) {
      if (k % 4) {
        chromaSvg(axesSvg, "line", { class: "chroma__grid chroma__grid--minor", x1: px, y1: 0, x2: px, y2: bottom });
        continue;
      }
      v = parseFloat((k * minor).toPrecision(12));
      if (v !== 0) {
        chromaSvg(axesSvg, "line", { class: "chroma__grid", x1: px, y1: 0, x2: px, y2: bottom });
        chromaSvg(axesSvg, "line", { class: "chroma__tick", x1: px, y1: y0 - 3, x2: px, y2: y0 + 3 });
      }
      chromaSvg(axesSvg, "text", { class: "chroma__tick-label", x: px, y: bottom + 12, "text-anchor": "middle" }, v);
    }
    for (k = Math.ceil((y0 - bottom + edge) / s / minor); (px = y0 - k * minor * s) >= edge + 14; k++) {
      if (k % 4) {
        chromaSvg(axesSvg, "line", { class: "chroma__grid chroma__grid--minor", x1: left, y1: px, x2: W, y2: px });
        continue;
      }
      v = parseFloat((k * minor).toPrecision(12));
      if (v !== 0) {
        chromaSvg(axesSvg, "line", { class: "chroma__grid", x1: left, y1: px, x2: W, y2: px });
        chromaSvg(axesSvg, "line", { class: "chroma__tick", x1: x0 - 3, y1: px, x2: x0 + 3, y2: px });
      }
      chromaSvg(axesSvg, "text", { class: "chroma__tick-label", x: left - 5, y: px, dy: "0.32em", "text-anchor": "end" }, v);
    }

    chromaSvg(axesSvg, "line", { class: "chroma__axis-line", x1: left, y1: y0, x2: W - 1, y2: y0 });
    chromaSvg(axesSvg, "line", { class: "chroma__axis-line", x1: x0, y1: bottom, x2: x0, y2: 1 });
    chromaSvg(axesSvg, "path", { class: "chroma__axis-line", d: "M" + (W - 7) + " " + (y0 - 3.5) + "L" + (W - 1) + " " + y0 + "L" + (W - 7) + " " + (y0 + 3.5) });
    chromaSvg(axesSvg, "path", { class: "chroma__axis-line", d: "M" + (x0 - 3.5) + " 7L" + x0 + " 1L" + (x0 + 3.5) + " 7" });
    // The titles go in a layer above the photos so a crowded map can't bury them.
    chromaSvg(titlesSvg, "text", { class: "chroma__axis-title", x: W - 2, y: y0 - 7, "text-anchor": "end" }, "Chromatic dimension 1");
    chromaSvg(titlesSvg, "text", { class: "chroma__axis-title", x: x0 + 8, y: 10 }, "Chromatic dimension 2");
  }

  function showTip(p) {
    tip.querySelector(".chroma__tip-img").src = base + p.thumb;
    tip.querySelector(".chroma__tip-title").textContent = title(p);
    tip.querySelector(".chroma__tip-loc").textContent = p.location || "";
    var W = mapEl.clientWidth, tw = tip.offsetWidth || 170, th = tip.offsetHeight || 190;
    var left = Math.min(Math.max(p._px - tw / 2, 4), W - tw - 4);
    var top = p._py - th - 30 >= 0 ? p._py - th - 30 : p._py + 30;
    tip.style.left = left + "px";
    tip.style.top = top + "px";
    tip.classList.add("is-visible");
  }

  function hideTip() {
    tip.classList.remove("is-visible");
  }

  function neighboursOf(p) {
    return p.nearest.filter(function (n) { return byId[n.id]; });
  }

  function drawLines() {
    while (svg.firstChild) {
      svg.removeChild(svg.firstChild);
    }
    if (!selected) {
      return;
    }
    neighboursOf(selected).forEach(function (n) {
      var q = byId[n.id];
      var line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", selected._px);
      line.setAttribute("y1", selected._py);
      line.setAttribute("x2", q._px);
      line.setAttribute("y2", q._py);
      svg.appendChild(line);
    });
  }

  function select(p) {
    selected = p;
    var near = {};
    if (p) {
      neighboursOf(p).forEach(function (n) { near[n.id] = true; });
    }
    root.classList.toggle("has-selection", !!p);
    photos.forEach(function (q) {
      q._pt.classList.toggle("is-selected", q === p);
      q._pt.classList.toggle("is-near", !!near[q.id]);
      q._pt.setAttribute("aria-pressed", q === p ? "true" : "false");
    });
    drawLines();
    if (hint) {
      hint.hidden = !!p;
    }
    selectedBox.hidden = !p;
    neighboursEl.innerHTML = "";
    if (!p) {
      return;
    }
    selectedTitle.textContent = title(p);
    selectedTitle.setAttribute("aria-label", "Open " + title(p));
    neighboursOf(p).forEach(function (n) {
      var q = byId[n.id];
      var btn = chromaEl("button", "chroma__nb");
      btn.type = "button";
      btn.setAttribute("aria-label", "Open " + title(q) + ", distance " + n.distance.toFixed(1));
      btn.appendChild(thumb(q));
      btn.appendChild(chromaEl("span", "chroma__nb-title", title(q)));
      btn.appendChild(chromaEl("span", "chroma__nb-dist", n.distance.toFixed(1)));
      btn.addEventListener("click", function () { openPhoto(q); });
      neighboursEl.appendChild(btn);
    });
  }

  selectedTitle.addEventListener("click", function () {
    if (selected) {
      openPhoto(selected);
    }
  });
  root.querySelector(".chroma__clear").addEventListener("click", function () { select(null); });
  mapEl.addEventListener("click", function () { select(null); });
  root.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && selected) {
      select(null);
    }
  });

  root.querySelector(".chroma__status").hidden = true;
  mapEl.hidden = false;
  panel.hidden = false;
  layout();
  if ("ResizeObserver" in window) {
    new ResizeObserver(layout).observe(mapEl);
  } else {
    window.addEventListener("resize", layout);
  }
  requestAnimationFrame(function () { root.classList.add("is-ready"); });
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
   Assemble the sidebar email link from its two split data attributes (see
   author-profile.html) so the address never appears intact in the served
   HTML, only in memory once JS runs.
   ========================================================================== */

function initEmailLinks() {
  document.querySelectorAll(".author__email-link").forEach(function (link) {
    if (link.dataset.mailInit) {
      return;
    }
    link.dataset.mailInit = "1";
    link.href = "mailto:" + link.dataset.mailA + "@" + link.dataset.mailB;
  });
}

/* ==========================================================================
   Per-page initialization — run on first load and again after every
   in-page (Swup) navigation. Kept idempotent so repeated calls are safe.
   ========================================================================== */

function initPage() {
  // #lightbox-overlay lives inside #page-content, so a Swup navigation while
  // it's open destroys and recreates it -- but <body> isn't swapped, so this
  // class would otherwise survive and hide the footer (see .page__footer
  // rule in _photo-grid.scss) on every page after that until a hard reload.
  document.body.classList.remove("lightbox-open");

  initEmailLinks();
  initResearchTabs();
  initPhotoLightbox();
  initPhotoFeature();
  initPhotoMap();
  initGeoGame();
  initChromatic();
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

  // Back-to-top button (the button lives in the persistent shell, outside
  // #page-content, so it never needs re-binding after a Swup navigation).
  var $backToTop = $('#back-to-top');
  if ($backToTop.length) {
    $(window).on('scroll', function () {
      $backToTop.toggleClass('is-visible', $(window).scrollTop() > 400);
    });
    $backToTop.on('click', function () {
      // Native smooth scroll rather than jQuery's $('html, body').animate():
      // animating scrollTop on both html and body at once makes them fight
      // each other if a second click interrupts the animation mid-flight
      // (a stutter -- a few px, stall, then jump). A repeat call here just
      // re-targets the same native scroll with no competing writes.
      var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
    });
  }

  // First-load page setup (research tabs, Plotly, Mermaid, footer height).
  initPage();
});

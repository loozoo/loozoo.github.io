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
  var items = Array.prototype.slice.call(document.querySelectorAll(".photo-grid__item"));
  var currentIndex = -1;
  var zoomRect = null;

  function showPhoto(index) {
    if (!items.length) {
      return;
    }
    currentIndex = (index + items.length) % items.length;
    overlayImg.src = items[currentIndex].getAttribute("href");
    overlay.classList.add("is-active");
  }

  function closeLightbox() {
    overlay.classList.remove("is-active");
    overlayImg.src = "";
    currentIndex = -1;
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
    closeLightbox: closeLightbox,
    getIndex: function () { return currentIndex; },
    updateZoomOrigin: updateZoomOrigin,
    stopZoom: stopZoom
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

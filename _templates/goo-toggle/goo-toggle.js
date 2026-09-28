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


---
permalink: /
title: "About Me"
author_profile: true
redirect_from: 
  - /about/
  - /about.html
---

<!-- bundle exec jekyll serve -l -H localhost -->

I'm a fourth-year undergraduate at Harvard, double majoring in mathematics (honours) and physics (Class of 2027). Alongside my bachelor's, I'm also completing a concurrent master's (A.M.) in mathematics. I recently spent Hilary & Trinity terms as a visiting student at Oriel College, Oxford University, studying at the [Mathematical Institute](https://www.maths.ox.ac.uk/). 


My [research interests]({{ "/research/" | relative_url }}) lie broadly in algebra, geometry, and topology, especially in
repurposing the traditionally pure machinery of these fields for applied tasks —
for example, using homological methods to study quantum error correction, or
topological methods for data analysis. I'm also interested in category theory and
relative algebraic geometry.


Outside of all this, I'm the academic lead for [NZPMC](https://www.nzpmc.com/). And away from academic work entirely, I enjoy cycling, [taking photos]({{ "/photos/" | relative_url }}), and Geoguessr/[OSINT](https://www.cambridge.org/core/journals/european-journal-of-international-security/article/rise-of-opensource-intelligence/21122432399ECB8078BF0D89A76D0586)-style puzzles. If you want to know more about the latter two, have a play around with some of the widgets below!

{% include chromatic-geography.html gallery_link=true compact=true widget=true %}

{% include geo-game.html compact=true widget=true %}

{% comment %} Shared by both widgets above: photos open here full size. {% endcomment %}
<div id="lightbox-overlay" class="lightbox-overlay">
  <span class="lightbox-overlay__close" aria-label="Close">&times;</span>
  <span class="lightbox-overlay__prev" aria-label="Previous photo">&#10094;</span>
  <img class="lightbox-overlay__img" src="" alt="">
  <div class="lightbox-overlay__caption">
    <span class="lightbox-overlay__caption-text"></span>
    <span class="lightbox-overlay__caption-location"></span>
    <span class="lightbox-overlay__caption-date"></span>
  </div>
  <span class="lightbox-overlay__next" aria-label="Next photo">&#10095;</span>
</div>

{% comment %}
  Featured "currently working on" teaser — hidden for now, re-enable by
  removing this comment block.

  A couple of things I'm currently working on (more on my [research page]({{ "/research/" | relative_url }})):

  <div class="research-list">
  {% assign featured_permalinks = "/research/homological-invariants-of-quantum-stabilizer-codes,/research/affine-group-schemes-in-relative-algebraic-geometry" | split: "," %}
  {% for permalink in featured_permalinks %}
    {% assign post = site.research | where: "permalink", permalink | first %}
    {% if post %}
      <div class="research-item">
        <h3 class="research-item__title">{{ post.title | markdownify | remove: "<p>" | remove: "</p>" }}</h3>
        {% if post.date_label or post.tags.size > 0 %}
          <p class="research-item__meta">
            {% if post.date_label %}<span class="research-item__date">{{ post.date_label }}</span>{% endif %}
            {% for tag in post.tags %}<span class="research-item__tag">{{ tag }}</span>{% endfor %}
          </p>
        {% endif %}
        <div class="research-item__description">{{ post.description | default: post.content | markdownify }}</div>
      </div>
    {% endif %}
  {% endfor %}
  </div>
{% endcomment %}


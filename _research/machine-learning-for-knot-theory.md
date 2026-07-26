---
title: "Machine Learning for Knot Theory"
collection: research
category: research
permalink: /research/machine-learning-for-knot-theory
order: 40
tags:
- Knot Theory
- Machine Learning
- Classification
date_label: "August 2025"
---

We apply machine learning to invariant regression and classification problems in knot theory. For regression, we use symbolic regression to obtain a two-variable empirical formula for hyperbolic volume from the Jones polynomial and crossing number. For classification, we build models for both geometric type (hyperbolic, satellite, torus) and knot primality. To support these classifiers, we develop a Reidemeister data augmentation technique that expands existing prime knot datasets by generating non-minimal diagrams and obfuscating trivial diagrammatic features. Models from natural language processing (LSTMs, Transformers) trained on these augmented datasets achieve over 93% accuracy in primality detection, surpassing existing Floer-homology-based heuristics, while geometric type classification highlights the challenges posed by class imbalance. Our results demonstrate that neural networks can learn diagram-invariant topological features, supporting classifiers as an efficient method to identify knot properties directly from their representations.

---
title: "On Odeco Tensors"
collection: research
category: writing
published: true
permalink: /research/odecotensors
order: 10
tags:
- Tensors
- Algebraic Geometry
- Data Analysis
date_label: "December 2025"
---

Orthogonally decomposable (odeco) tensors are the symmetric tensors that can be expressed as \\( T = \sum_{i=1}^n \lambda_i v_i^{\otimes d} \\) with \\( \\{v_i\\} \\) orthonormal. This is an orthogonal sum of pure powers, and is a natural generalisation of the spectral decomposition of a symmetric matrix. Borrowing ideas from algebraic geometry, these tensors can be assembled into the odeco variety, an algebraic subvariety of the space of all symmetric tensors, whose structure and identifiability we study. We then give an application to latent-variable models: after whitening, the third cumulant tensor of the data becomes odeco, so its orthogonal decomposition recovers the latent components. We demonstrate this on the classic problem of blind source separation, unmixing linearly combined MNIST digit images.


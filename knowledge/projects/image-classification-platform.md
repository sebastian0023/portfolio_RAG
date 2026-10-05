---
id: proj-image-classification
title: Image Classification Platform
kind: project
lang: en
updated: 2026-10-05
reviewed: false
---

The Image Classification Platform is a project where Daniel was the project manager. It was built with Python, PyTorch, FastAPI, React, TypeScript, MLflow, DVC, and AWS S3.

## Pipeline and results

The team delivered a three-class image classification pipeline built on 1,459 COCO image crops, with reproducible 70/20/10 data splits. Daniel fine-tuned ResNet-18 and tracked 12 experiments in MLflow. The selected model reached 97.9% accuracy and 97.4% macro F1 on a held-out test set of 145 crops.

## Web portal

Training, experiment comparison, evaluation, model versioning, and image inference were integrated into a web portal. Versioned model artifacts are published to S3.

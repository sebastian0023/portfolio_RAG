---
id: proj-lift
title: Lift, Workout Tracking PWA
kind: project
lang: en
updated: 2026-10-05
reviewed: false
---

Lift is a full-stack workout tracking progressive web app. It is mobile-first and built with React, TypeScript, Vite, Tailwind CSS, AWS Lambda, DynamoDB, Cognito, SQS, Bedrock, and Terraform.

## Features

Users plan routines, log sets, track personal records and body weight, and review their training history. The app can also import workout plans from Markdown.

## Backend and AI

The serverless AWS backend has authenticated APIs, DynamoDB storage, and SQS workers for workout updates and routine creation. Amazon Bedrock generates AI training plans. Key user journeys are tested with Vitest and Playwright.

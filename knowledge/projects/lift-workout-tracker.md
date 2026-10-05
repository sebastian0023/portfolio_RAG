---
id: proj-lift
title: Lift, Workout Tracking PWA
kind: project
lang: en
updated: 2026-10-05
reviewed: false
---

Lift is a full-stack workout tracking progressive web app. It is mobile-first, has a warm monochrome look with a light theme by default and a dark option, and is built with React, TypeScript, Vite, Tailwind CSS, AWS Lambda, DynamoDB, Cognito, SQS, Bedrock, and Terraform. The source repository is private.

## Features

Users plan routines, log sets with weight and reps, and track personal records, body weight, and training streaks. They can review past weeks, use a rest timer, and switch between kilograms and pounds. An exercise library has guides with steps, form cues, and common mistakes.

## Creating a routine

A routine can come from a Markdown file or from an AI form. Markdown uploads are parsed by a deterministic parser, so they use no AI tokens. The AI form sends the user's goals to Amazon Bedrock, which returns a structured routine that the user previews before applying.

## Backend

The serverless AWS backend uses Node.js Lambda functions behind API Gateway, DynamoDB single-table storage, and Cognito authentication. Reads and simple writes go straight to DynamoDB. Longer work, such as completing a set or generating a routine, goes through SQS queues with dead-letter queues and worker Lambdas. Terraform defines the infrastructure with one module per AWS service.

## Testing

The project has unit tests and Playwright mobile browser journeys. A mock mode with an in-memory backend lets it run locally without AWS.

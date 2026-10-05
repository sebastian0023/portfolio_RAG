---
id: proj-relationship-rag
title: Relationship RAG
kind: project
lang: en
updated: 2026-10-05
url: https://github.com/sebastian0023/relationship-rag
reviewed: false
---

Relationship RAG is a full-stack AI application built with Angular, TypeScript, AWS CDK, Lambda, DynamoDB, S3, Amazon Bedrock, SQS, and EventBridge. It is a private web app for two invited users, so it has no public demo.

## What it does

Users save memories and photos, explore a shared timeline, and create AI-assisted cards. Cards can be delivered immediately or on a schedule.

## Retrieval-augmented chat

Daniel implemented a chat assistant that answers from the stored memories, cites its sources, and abstains when the evidence is insufficient. The memories are indexed with S3 Vectors and Titan Text Embeddings V2.

## Architecture and testing

The serverless AWS architecture has tenant-scoped access and retryable background processing. It is covered by automated tests and RAG evaluations for grounding, authorization, and contracts. The code is organized with ports and adapters, so domain code does not import AWS SDK clients.

---
id: proj-serverless-portfolio
title: Serverless AI Portfolio with RAG Chat
kind: project
lang: en
updated: 2026-10-05
reviewed: true
---

This portfolio website is itself one of Daniel's projects. It is built with Angular, TypeScript, AWS, and Terraform. The source repository is private.

## Site and chat API

Daniel built and deployed a responsive Angular portfolio with a streaming chat API. It runs on AWS Lambda, CloudFront, private S3, and Amazon Bedrock.

## Retrieval pipeline

The chat answers from a reviewed public knowledge base. The pipeline has Markdown ingestion, Titan embeddings, and S3 Vectors search. Answers are grounded and cite the passages they use. An evaluation gate controls index promotion and rollback.

## Security

Public access is secured with Cloudflare Turnstile, signed guest passes, and atomic DynamoDB quotas. Automated security and browser checks run on every change.

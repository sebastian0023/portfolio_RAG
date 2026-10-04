import { fakeProvider } from './fake-llm-provider.js';
import { runLlmProviderContract } from './llm-provider-contract.js';

runLlmProviderContract('fake', { build: fakeProvider });

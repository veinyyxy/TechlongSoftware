import { safeContinuationFailureV5 } from '../install/continuation-secrets-v5.mjs';
export class ActivationAssertionErrorV5 extends Error {
  constructor(code) { super('ACTIVATION_ASSERTION'); this.assertion = /^[A-Z][A-Z0-9_]{0,79}$/.test(code) ? code : 'INVALID_ASSERTION_CODE'; }
}
export function requireActivationV5(value,code) { if (!value) throw new ActivationAssertionErrorV5(code); }
export function safeActivationFailureV5(error) {
  return { ...safeContinuationFailureV5(error),activationAssertion: error instanceof ActivationAssertionErrorV5 ? error.assertion : null };
}

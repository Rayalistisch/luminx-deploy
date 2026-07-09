/**
 * LuminX does not throw across package boundaries. An expected failure — a missing config,
 * a protocol mismatch, a rejected operation — is a value the caller must handle, not a
 * control-flow jump they can forget to catch.
 *
 * Exceptions remain for genuine bugs: a violated invariant is not something a caller can
 * recover from, and hiding it behind a Result only delays the stack trace.
 */

export type Result<T, E> = Ok<T> | Err<E>;

export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

export interface Err<E> {
  readonly ok: false;
  readonly error: E;
}

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });
export const err = <E>(error: E): Err<E> => ({ ok: false, error });

export const isOk = <T, E>(result: Result<T, E>): result is Ok<T> => result.ok;
export const isErr = <T, E>(result: Result<T, E>): result is Err<E> => !result.ok;

/** Transforms the success value; an error passes through untouched. */
export const map = <T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> =>
  result.ok ? ok(fn(result.value)) : result;

/** Transforms the error; a success passes through untouched. */
export const mapErr = <T, E, F>(result: Result<T, E>, fn: (error: E) => F): Result<T, F> =>
  result.ok ? result : err(fn(result.error));

/** Chains a fallible step. The second step runs only if the first succeeded. */
export const andThen = <T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, E>,
): Result<U, E> => (result.ok ? fn(result.value) : result);

export const unwrapOr = <T, E>(result: Result<T, E>, fallback: T): T =>
  result.ok ? result.value : fallback;

/**
 * Collects many results into one. Fails on the first error rather than accumulating:
 * a plan built on a broken resource is not worth validating further.
 */
export const all = <T, E>(results: readonly Result<T, E>[]): Result<readonly T[], E> => {
  const values: T[] = [];
  for (const result of results) {
    if (!result.ok) return result;
    values.push(result.value);
  }
  return ok(values);
};

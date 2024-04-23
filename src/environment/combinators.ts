import type { Composable, UnpackData } from '../types.ts'
import * as A from '../combinators.ts'
import { composable, fromSuccess } from '../constructors.ts'
import { CommonEnvironment } from './types.ts'

/**
 * Takes a function with 2 parameters and partially applies the second one.
 * This is useful when one wants to use a domain function having a fixed environment.
 * @example
 * import { mdf, applyEnvironment } from 'domain-functions'
 *
 * const endOfDay = mdf(z.date(), z.object({ timezone: z.string() }))((date, { timezone }) => ...)
 * const endOfDayUTC = applyEnvironment(endOfDay, { timezone: 'UTC' })
 * //    ^? (input: unknown) => Promise<Result<Date>>
 */
function applyEnvironment<
  I extends any,
  E extends any,
  Fn extends (input: I, environment: E) => any,
>(df: Fn, environment: E) {
  return (input: I) => df(input, environment) as ReturnType<Fn>
}

function applyEnvironmentToList<
  Fns extends Array<(input: unknown, environment: unknown) => unknown>,
>(fns: Fns, environment: unknown) {
  return fns.map((fn) => applyEnvironment(fn, environment)) as [Composable]
}

/**
 * Creates a single domain function out of a chain of multiple domain functions. It will pass the same environment to all given functions, and it will pass the output of a function as the next function's input in left-to-right order. The resulting data will be the output of the rightmost function.
 * @example
 * import { mdf, pipe } from 'domain-functions'
 *
 * const a = mdf(z.object({ aNumber: z.number() }))(
 *   ({ aNumber }) => ({ aString: String(aNumber) }),
 * )
 * const b = mdf(z.object({ aString: z.string() }))(
 *   ({ aString }) => ({ aBoolean: aString == '1' }),
 * )
 * const d = pipe(a, b)
 * //    ^? Composable<(input?: unknown, environment?: unknown) => { aBoolean: boolean }>
 */
function pipe<Fns extends Composable[]>(...fns: Fns) {
  return ((input, environment) =>
    A.pipe(...applyEnvironmentToList(fns, environment))(
      input,
    )) as CommonEnvironment<Fns>
}

/**
 * Works like `pipe` but it will collect the output of every function in a tuple.
 * @example
 * import { mdf, sequence } from 'domain-functions'
 *
 * const a = mdf(z.number())((aNumber) => String(aNumber))
 * const b = mdf(z.string())((aString) => aString === '1')
 * const df = sequence(a, b)
 * //    ^? Composable<(input?: unknown, environment?: unknown) => [string, boolean]>
 */

function sequence<Fns extends Composable[]>(...fns: Fns) {
  return ((input, environment) =>
    A.sequence(...applyEnvironmentToList(fns, environment))(
      input,
    )) as CommonEnvironment<Fns>
}

/**
 * Use it to add conditional logic to your domain functions' compositions.
 * It receives a domain function and a predicate function that should return the next domain function to be executed based on the previous domain function's output, like `pipe`. If the predicate returns `null` the result of the previous domain function will be returned and it won't be piped.
 * @example
 * import { mdf, branch } from 'domain-functions'
 *
 * const getIdOrEmail = mdf(z.object({ id: z.number().optional(), email: z.string().optional() }))((data) => data.id ?? data.email)
 * const findUserById = mdf(z.number())((id) => db.users.find({ id }))
 * const findUserByEmail = mdf(z.string().email())((email) => db.users.find({ email }))
 * const findUserByIdOrEmail = branch(
 *   getIdOrEmail,
 *   (output) => (typeof output === "number" ? findUserById : findUserByEmail)
 * )
 * //    ^? Composable<(input?: unknown, environment?: unknown) => User>
 *
 * const getStock = mdf(z.any(), z.object({ id: z.number() }))(_, ({ id }) => db.stocks.find({ id }))
 * const getExtraStock = mdf(z.any(), z.object({ id: z.number() }))(_, ({ id }) => db.stockes.find({ id, extra: true }))
 *
 * const getStockOrExtraStock = branch(
 *  getStock,
 *  ({ items }) => (items.length >= 0 ? null : getExtraStock)
 * )
 * //   ^? Composable<(input?: unknown, environment?: unknown) => { items: Item[] }>
 */
function branch<O, E extends any, MaybeFn extends Composable | null>(
  dfn: Composable<(input?: unknown, environment?: E) => O>,
  resolver: (o: O) => Promise<MaybeFn> | MaybeFn,
) {
  return (async (input, environment: E) => {
    const result = await dfn(input, environment)
    if (!result.success) return result

    return composable(async () => {
      const nextDf = await resolver(result.data)
      if (typeof nextDf !== 'function') return result.data
      return fromSuccess(nextDf)(result.data, environment)
    })()
  }) as Composable<
    (
      input?: unknown,
      environment?: unknown,
    ) => MaybeFn extends Composable<
      (input?: unknown, environment?: unknown) => infer BranchOutput
    >
      ? BranchOutput
      : UnpackData<NonNullable<MaybeFn>> | O
  >
}

export { applyEnvironment, branch, pipe, sequence }

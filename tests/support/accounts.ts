/** One-account accounts service for focused tests that own their fixtures. */
import { fixedDataAgentAccounts } from '../../src/accounts.ts'

/**
 * Build the `dataAgentAccounts` seat a fixture Context needs.
 * @param scope - whichever of connections/catalog/scanner/review the test supplies.
 * @returns the accounts service serving exactly that scope.
 */
export function testAccounts(scope: Record<string, unknown>) {
  return fixedDataAgentAccounts(scope as never)
}

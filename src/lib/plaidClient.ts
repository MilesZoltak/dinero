import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid';

export function getPlaidClient(): PlaidApi | null {
  const plaidClientId = process.env.PLAID_CLIENT_ID;
  const plaidSecret = process.env.PLAID_SECRET;
  const plaidEnv = process.env.PLAID_ENV || 'sandbox';

  if (!plaidClientId || !plaidSecret) {
    return null;
  }

  const environment = PlaidEnvironments[plaidEnv as keyof typeof PlaidEnvironments] || PlaidEnvironments.sandbox;

  const configuration = new Configuration({
    basePath: environment,
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': plaidClientId,
        'PLAID-SECRET': plaidSecret,
      },
    },
  });

  return new PlaidApi(configuration);
}

export function isPlaidEnabled(): boolean {
  return getPlaidClient() !== null;
}

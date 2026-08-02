import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid';

const plaidClientId = process.env.PLAID_CLIENT_ID;
const plaidSecret = process.env.PLAID_SECRET;
const plaidEnv = process.env.PLAID_ENV || 'sandbox';

let plaidClient: PlaidApi | null = null;

if (plaidClientId && plaidSecret) {
  try {
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

    plaidClient = new PlaidApi(configuration);
    console.log(`Plaid Client initialized in ${plaidEnv} environment.`);
  } catch (error) {
    console.error('Failed to initialize Plaid Client:', error);
  }
} else {
  console.warn('Plaid credentials missing in .env.local. Operating in Mock Plaid Sandbox mode.');
}

export function isPlaidEnabled(): boolean {
  return plaidClient !== null;
}

export { plaidClient };

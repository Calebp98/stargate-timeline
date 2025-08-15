interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

export class SentinelAuth {
  private token: string | null = null;
  private tokenExpiry: number = 0;
  private clientId: string;
  private clientSecret: string;

  constructor() {
    this.clientId = import.meta.env.PUBLIC_SENTINEL_CLIENT_ID;
    this.clientSecret = import.meta.env.PUBLIC_SENTINEL_CLIENT_SECRET;
    
    if (!this.clientId || !this.clientSecret) {
      throw new Error('Sentinel Hub credentials not found in environment variables');
    }
  }

  async getToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiry) {
      return this.token;
    }

    const response = await fetch('https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }),
    });

    if (!response.ok) {
      throw new Error(`Authentication failed: ${response.status} ${response.statusText}`);
    }

    const data: TokenResponse = await response.json();
    this.token = data.access_token;
    this.tokenExpiry = Date.now() + (data.expires_in * 1000) - 60000; // Refresh 1 minute early

    return this.token;
  }
}
export const getStepsFromGoogleFit = async (): Promise<number> => {
  try {
    const backendUrl = 'http://localhost:5001';

    // Get login URL from backend
    const response = await fetch(`${backendUrl}/auth/login`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`Backend error: ${response.status}`);
    }

    const data = await response.json();
    if (data.authUrl) {
      window.location.href = data.authUrl;
    }
    return 0;
  } catch (error) {
    console.error('Error initiating Google Fit sync:', error);
    alert('❌ Backend server not responding. Make sure backend is running on port 5001.');
    throw error;
  }
};

export const syncStepsFromBackend = async (): Promise<number> => {
  try {
    const backendUrl = 'http://localhost:5001';
    const userId = 'default_user';
    const today = new Date().toISOString().split('T')[0];

    const response = await fetch(`${backendUrl}/api/steps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, date: today }),
    });

    if (!response.ok) {
      if (response.status === 401) {
        alert('Please authenticate first by clicking "Connect Google Fit"');
        return 0;
      }
      throw new Error(`Backend error: ${response.status}`);
    }

    const data = await response.json();
    return data.steps || 0;
  } catch (error) {
    console.error('Error fetching steps from backend:', error);
    alert('❌ Failed to sync with backend. Check console for details.');
    throw error;
  }
};



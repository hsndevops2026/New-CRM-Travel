export const rapidApiConfig = {
  key: process.env.RAPIDAPI_KEY || '',
  host: process.env.RAPIDAPI_HOST || 'booking-com15.p.rapidapi.com',
  baseUrl:
    process.env.RAPIDAPI_BASE_URL || 'https://booking-com15.p.rapidapi.com/api/v1',
  airbnbKey: process.env.RAPIDAPI_AIRBNB_KEY || process.env.RAPIDAPI_KEY || '',
  airbnbHost: process.env.RAPIDAPI_AIRBNB_HOST || 'airbnb19.p.rapidapi.com',
  airbnbBaseUrl:
    process.env.RAPIDAPI_AIRBNB_BASE_URL || 'https://airbnb19.p.rapidapi.com',
};

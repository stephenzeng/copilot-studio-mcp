import axios, { AxiosInstance } from 'axios';

export interface Park {
  id: string;
  url: string;
  fullName: string;
  parkCode: string;
  description: string;
  latitude: string;
  longitude: string;
  latLong: string;
  activities: any[];
  topics: any[];
  states: string;
  contacts: any;
  entranceFees: any[];
  entrancePasses: any[];
  fees: any[];
  directionsInfo: string;
  directionsUrl: string;
  operatingHours: any[];
  addresses: any[];
  images: any[];
  weatherInfo: string;
  name: string;
  designation: string;
}

export interface ParksResponse {
  total: string;
  data: Park[];
  limit: string;
  start: string;
}

export interface GetParksParams {
  parkCode?: string;
  stateCode?: string;
  limit?: number;
  start?: number;
  q?: string;
}

export class ParksService {
  private axiosInstance: AxiosInstance;
  private readonly baseUrl = 'https://developer.nps.gov/api/v1';

  constructor() {
    this.axiosInstance = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'Accept': 'application/json',
      },
    });
  }

  async getParks(apiKey: string, params: GetParksParams = {}): Promise<ParksResponse> {
    const response = await this.axiosInstance.get<ParksResponse>('/parks', {
      params: {
        ...params,
        api_key: apiKey,
      },
    });
    // Return only the first 3 items of the collection
    const data = response.data;
    return {
      ...data,
      data: data.data.slice(0, 3),
    };
  }
}

import axios, { AxiosInstance } from 'axios';

export interface Activity {
  id: string;
  name: string;
}

export interface ActivitiesResponse {
  total: string;
  data: Activity[];
  limit: string;
  start: string;
}

export interface GetActivitiesParams {
  id?: string;
  q?: string;
  limit?: string;
  start?: number;
  sort?: string;
}

export class ActivitiesService {
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

  async getActivities(apiKey: string, params: GetActivitiesParams = {}): Promise<ActivitiesResponse> {
    const response = await this.axiosInstance.get<ActivitiesResponse>('/activities', {
      params: {
        ...params,
        api_key: apiKey,
      },
    });
    return response.data;
  }
}

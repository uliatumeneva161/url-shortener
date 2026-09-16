export interface ShortenResult {
  code: string;
  url: string;
  short_url: string;
}

export interface User {
  id: number;
  email: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface MyLink {
  code: string;
  url: string;
  created_at: string;
  clicks: number;
  short_url: string;
}

export interface StatsResponse {
  code: string;
  url: string;
  created_at: string;
  total_clicks: number;
  recent_clicks: RecentClick[];
}

export interface RecentClick {
  clicked_at: string;
  ip: string;
  user_agent: string;
  referer: string;
}
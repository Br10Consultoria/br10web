// ─── Auth Types ───────────────────────────────────────────────────────────────
export interface User {
  id: string;
  username: string;
  email: string;
  full_name: string;
  role: 'admin' | 'technician' | 'viewer';
  is_active: boolean;
  is_verified: boolean;
  totp_enabled: boolean;
  last_login: string | null;
  last_login_ip: string | null;
  created_at: string;
  avatar_url: string | null;
  phone: string | null;
}

export interface LoginRequest {
  username: string;
  password: string;
  totp_code?: string;
}

export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  user_id: string;
  username: string;
  role: string;
  requires_2fa: boolean;
  two_fa_setup_required: boolean;
}

// ─── Device Types ─────────────────────────────────────────────────────────────
export type DeviceType =
  | 'huawei_ne8000'
  | 'huawei_6730'
  | 'datacom'
  | 'vsol_olt'
  | 'mikrotik'
  | 'cisco'
  | 'juniper'
  | 'generic_router'
  | 'generic_switch'
  | 'generic_olt'
  | 'other';

export type DeviceStatus = 'online' | 'offline' | 'unknown' | 'maintenance' | 'alert';
export type ConnectionProtocol = 'ssh' | 'telnet' | 'winbox' | 'http' | 'https' | 'console';

export interface DeviceVlan {
  id: string;
  device_id: string;
  vlan_id: number;
  name: string | null;
  description: string | null;
  ip_address: string | null;
  subnet_mask: string | null;
  gateway: string | null;
  is_management: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface DevicePort {
  id: string;
  device_id: string;
  port_name: string;
  port_number: string | null;
  port_type: string;
  status: string;
  speed_mbps: number | null;
  duplex: string | null;
  vlan_id: number | null;
  description: string | null;
  mac_address: string | null;
  ip_address: string | null;
  is_trunk: boolean;
  allowed_vlans: number[] | null;
  connected_device: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Device {
  id: string;
  name: string;
  hostname: string | null;
  description: string | null;
  location: string | null;
  site: string | null;
  device_type: DeviceType;
  status: DeviceStatus;
  manufacturer: string | null;
  model: string | null;
  firmware_version: string | null;
  serial_number: string | null;
  management_ip: string;
  management_port: number | null;
  primary_protocol: ConnectionProtocol;
  username: string | null;
  ssh_port: number;
  telnet_port: number;
  winbox_port: number | null;
  http_port: number | null;
  https_port: number | null;
  subnet_mask: string | null;
  gateway: string | null;
  dns_primary: string | null;
  dns_secondary: string | null;
  loopback_ip: string | null;
  tags: string[] | null;
  custom_fields: Record<string, any> | null;
  last_seen: string | null;
  last_backup: string | null;
  uptime_seconds: number | null;
  cpu_usage: number | null;
  memory_usage: number | null;
  photo_url: string | null;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
  vlans?: DeviceVlan[];
  ports?: DevicePort[];
}

export interface DeviceListItem {
  id: string;
  name: string;
  hostname: string | null;
  management_ip: string;
  device_type: DeviceType;
  status: DeviceStatus;
  location: string | null;
  site: string | null;
  manufacturer: string | null;
  model: string | null;
  is_active: boolean;
  last_seen: string | null;
  photo_url: string | null;
  tags: string[] | null;
  created_at: string;
}

export interface DeviceStats {
  total: number;
  online: number;
  offline: number;
  alert: number;
  unknown: number;
  by_type: Record<string, number>;
}

// ─── VPN Types ────────────────────────────────────────────────────────────────
export interface StaticRoute {
  id: string;
  device_id: string;
  vpn_config_id: string | null;
  destination_network: string;
  next_hop: string;
  interface: string | null;
  metric: number;
  description: string | null;
  is_active: boolean;
  is_persistent: boolean;
  applied_at: string | null;
  last_verified: string | null;
  created_at: string;
  updated_at: string;
}

export interface VpnConfig {
  id: string;
  device_id: string;
  name: string;
  description: string | null;
  vpn_type: string;
  status: string;
  server_ip: string;
  server_port: number | null;
  username: string | null;
  local_ip: string | null;
  remote_ip: string | null;
  local_subnet: string | null;
  remote_subnet: string | null;
  tunnel_ip: string | null;
  authentication_type: string;
  mtu: number;
  mru: number;
  ipsec_enabled: boolean;
  ipsec_encryption: string;
  ipsec_hash: string;
  ipsec_dh_group: string;
  auto_reconnect: boolean;
  keepalive_interval: number;
  is_active: boolean;
  connected_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  static_routes: StaticRoute[];
}

// ─── API Response Types ───────────────────────────────────────────────────────
export interface ApiError {
  detail: string;
  status?: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  per_page: number;
}

// ─── UI Types ─────────────────────────────────────────────────────────────────
export interface NavItem {
  label: string;
  path: string;
  icon: React.ComponentType<any>;
  badge?: number;
  children?: NavItem[];
  roles?: string[];
}

export type ToastType = 'success' | 'error' | 'warning' | 'info';

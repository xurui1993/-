import * as XLSX from "xlsx";

export const getWorkspaceId = () => {
    let wid = localStorage.getItem('app_workspace_id');
    return wid || 'default-workspace';
};

export const fetchWithAuth = (url: string, options: RequestInit = {}) => {
  const headers = new Headers(options.headers || {});
  headers.set("x-workspace-id", encodeURIComponent(getWorkspaceId()));
  return fetch(url, { ...options, headers });
};

export const loadConfigExcelData = async (configPath?: string) => {
  try {
    let targetPath = configPath;
    if (!targetPath) {
      try {
        const res = await fetchWithAuth("/api/default_paths");
        if (res.ok) {
          const paths = await res.json();
          targetPath = paths.configPath;
        }
      } catch (e) {
        // ignore
      }
    }
    if (!targetPath) targetPath = "data/config.json";
    if (targetPath.endsWith("config.xlsx")) {
      targetPath = targetPath.replace("config.xlsx", "config.json");
    }
    
    let fileRes = await fetchWithAuth(`/api/download?path=${encodeURIComponent(targetPath)}`);
    if (!fileRes.ok && targetPath !== "data/config.json") {
      targetPath = "data/config.json";
      fileRes = await fetchWithAuth(`/api/download?path=${encodeURIComponent(targetPath)}`);
    }
    
    if (!fileRes.ok) {
      return { success: false, data: null };
    }
    
    let rows: any[] = [];
    try {
      rows = await fileRes.json();
    } catch (e) {
      return { success: false, data: null };
    }
    
    if (!rows || !Array.isArray(rows) || rows.length === 0) return { success: false, data: null };
    
    const cities: Record<string, any> = {};
    let lastCity = "";
    
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;
      
      let city = row["城市"] || row["city"];
      if (city) lastCity = String(city).trim();
      
      if (lastCity) {
        const cityStr = lastCity;
        const team = row["团队名称"] || row["团队"] || row["team"];
        let teamStr = team ? String(team) : "";

        if (!cities[cityStr]) {
          cities[cityStr] = {
            total_riders: 0,
            total_orders: 0,
            fengshen_bind_rate: "0.0%",
            shangyi_bind_rate: "0.0%",
            black_count: 0,
            stations: []
          };
        }
        
        if (teamStr && !cities[cityStr].stations.find((s: any) => s.station_name === teamStr)) {
           cities[cityStr].stations.push({
             station_name: teamStr,
             total_riders: 0,
             total_orders: 0,
             fengshen_bind_rate: "0.0%",
             shangyi_bind_rate: "0.0%",
             black_count: 0
           });
        }
      }
    }
    
    return {
      success: true,
      data: {
        overall: { total_riders: 0, total_orders: 0, fengshen_bind_rate: "0.0%", shangyi_bind_rate: "0.0%", black_count: 0, fengshen_bind_count: 0, shangyi_bind_count: 0 },
        cities
      }
    };
  } catch (err) {
    return { success: false, data: null };
  }
};

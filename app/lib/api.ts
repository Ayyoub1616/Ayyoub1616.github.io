const configured=(import.meta.env.VITE_API_BASE_URL as string|undefined)||'';
export const API_BASE=configured.replace(/\/$/,'');
export const apiUrl=(path:string)=>`${API_BASE}${path}`;

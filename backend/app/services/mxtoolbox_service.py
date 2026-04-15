"""
BR10 NetManager - Serviço de Integração MxToolbox

Integra com a API REST do MxToolbox para:
  - Blacklist check (IP/domínio contra centenas de blacklists)
  - DNS lookup (MX, A, AAAA, PTR, SPF, DMARC, etc.)
  - Monitor query (status de monitores configurados na conta MxToolbox)

Documentação: https://mxtoolbox.com/api/
Endpoint base: https://api.mxtoolbox.com/api/v1/
"""
import logging
import time
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)

MXTOOLBOX_BASE_URL = "https://api.mxtoolbox.com/api/v1"
TIMEOUT = httpx.Timeout(30.0)


class MxToolboxService:
    """
    Cliente para a API REST do MxToolbox.
    Requer uma API Key válida (plano Free ou pago).
    """

    def __init__(self, api_key: str):
        self.api_key = api_key
        self.headers = {
            "Authorization": api_key,
            "Content-Type": "application/json",
        }

    async def blacklist_check(self, target: str) -> Dict[str, Any]:
        """
        Verifica um IP ou domínio contra centenas de blacklists via MxToolbox.

        Retorna:
          {
            "target": str,
            "status": "clean" | "listed" | "error",
            "listed_count": int,
            "checked_count": int,
            "blacklists_found": [{"name": str, "url": str, "info": str}],
            "all_results": [...],
            "error": str | None,
            "duration_ms": int,
          }
        """
        start = time.time()
        result = {
            "target": target,
            "status": "unknown",
            "listed_count": 0,
            "checked_count": 0,
            "blacklists_found": [],
            "all_results": [],
            "error": None,
            "duration_ms": 0,
        }

        try:
            url = f"{MXTOOLBOX_BASE_URL}/Lookup/blacklist/?argument={target}"
            async with httpx.AsyncClient(timeout=TIMEOUT) as client:
                resp = await client.get(url, headers=self.headers)

            result["duration_ms"] = int((time.time() - start) * 1000)

            if resp.status_code == 401:
                result["status"] = "error"
                result["error"] = "API Key inválida ou expirada. Verifique a chave do MxToolbox."
                return result

            if resp.status_code == 429:
                result["status"] = "error"
                result["error"] = "Limite de requisições da API MxToolbox atingido. Aguarde e tente novamente."
                return result

            if resp.status_code != 200:
                result["status"] = "error"
                result["error"] = f"Erro na API MxToolbox: HTTP {resp.status_code}"
                return result

            data = resp.json()

            # Processar resultados
            failed = data.get("Failed", [])
            passed = data.get("Passed", [])
            information = data.get("Information", [])

            all_results = []

            # Blacklists onde está LISTADO (Failed)
            blacklists_found = []
            for item in failed:
                entry = {
                    "name": item.get("Name", ""),
                    "url": item.get("PublicDescription", ""),
                    "info": item.get("Info", ""),
                    "status": "listed",
                }
                blacklists_found.append(entry)
                all_results.append(entry)

            # Blacklists onde está LIMPO (Passed)
            for item in passed:
                all_results.append({
                    "name": item.get("Name", ""),
                    "url": item.get("PublicDescription", ""),
                    "info": item.get("Info", ""),
                    "status": "clean",
                })

            result["listed_count"] = len(failed)
            result["checked_count"] = len(failed) + len(passed)
            result["blacklists_found"] = blacklists_found
            result["all_results"] = all_results
            result["status"] = "listed" if blacklists_found else "clean"

            # Informações adicionais (PTR, ASN, etc.)
            if information:
                result["information"] = [
                    {"name": i.get("Name", ""), "info": i.get("Info", "")}
                    for i in information
                ]

        except httpx.TimeoutException:
            result["status"] = "error"
            result["error"] = "Timeout ao consultar a API MxToolbox (30s)."
            result["duration_ms"] = int((time.time() - start) * 1000)
        except Exception as e:
            result["status"] = "error"
            result["error"] = f"Erro inesperado: {str(e)}"
            result["duration_ms"] = int((time.time() - start) * 1000)
            logger.error(f"[MxToolbox] Erro ao verificar {target}: {e}", exc_info=True)

        return result

    async def dns_lookup(self, command: str, argument: str) -> Dict[str, Any]:
        """
        Executa um lookup DNS via MxToolbox.

        Comandos disponíveis: mx, a, aaaa, ptr, spf, dmarc, txt, ns, soa, blacklist, smtp, ping, trace
        """
        start = time.time()
        try:
            url = f"{MXTOOLBOX_BASE_URL}/Lookup/{command}/?argument={argument}"
            async with httpx.AsyncClient(timeout=TIMEOUT) as client:
                resp = await client.get(url, headers=self.headers)

            duration_ms = int((time.time() - start) * 1000)

            if resp.status_code == 401:
                return {"error": "API Key inválida.", "duration_ms": duration_ms}
            if resp.status_code != 200:
                return {"error": f"HTTP {resp.status_code}", "duration_ms": duration_ms}

            data = resp.json()
            return {
                "command": command,
                "argument": argument,
                "information": data.get("Information", []),
                "passed": data.get("Passed", []),
                "failed": data.get("Failed", []),
                "warnings": data.get("Warnings", []),
                "duration_ms": duration_ms,
            }
        except Exception as e:
            return {
                "error": str(e),
                "duration_ms": int((time.time() - start) * 1000),
            }

    async def get_monitors(self) -> Dict[str, Any]:
        """
        Retorna os monitores configurados na conta MxToolbox.
        Requer plano pago com acesso à API de monitores.
        """
        start = time.time()
        try:
            url = f"{MXTOOLBOX_BASE_URL}/Monitor/"
            async with httpx.AsyncClient(timeout=TIMEOUT) as client:
                resp = await client.get(url, headers=self.headers)

            duration_ms = int((time.time() - start) * 1000)

            if resp.status_code == 401:
                return {"error": "API Key inválida.", "monitors": [], "duration_ms": duration_ms}
            if resp.status_code != 200:
                return {"error": f"HTTP {resp.status_code}", "monitors": [], "duration_ms": duration_ms}

            data = resp.json()
            return {
                "monitors": data if isinstance(data, list) else data.get("Monitors", []),
                "duration_ms": duration_ms,
            }
        except Exception as e:
            return {
                "error": str(e),
                "monitors": [],
                "duration_ms": int((time.time() - start) * 1000),
            }

    async def test_api_key(self) -> Dict[str, Any]:
        """
        Testa se a chave de API é válida fazendo uma consulta simples.
        Retorna {"valid": bool, "error": str | None, "usage": dict | None}
        """
        try:
            # Usa um IP público conhecido (Google DNS) para testar
            url = f"{MXTOOLBOX_BASE_URL}/Lookup/blacklist/?argument=8.8.8.8"
            async with httpx.AsyncClient(timeout=httpx.Timeout(15.0)) as client:
                resp = await client.get(url, headers=self.headers)

            if resp.status_code == 200:
                return {"valid": True, "error": None}
            elif resp.status_code == 401:
                return {"valid": False, "error": "API Key inválida ou expirada."}
            elif resp.status_code == 429:
                # Limite atingido mas a chave é válida
                return {"valid": True, "error": "Limite de requisições atingido."}
            else:
                return {"valid": False, "error": f"HTTP {resp.status_code}"}
        except Exception as e:
            return {"valid": False, "error": str(e)}


async def get_mxtoolbox_service_from_db(db) -> Optional[MxToolboxService]:
    """
    Obtém uma instância do MxToolboxService com a chave de API do banco de dados.
    Retorna None se a chave não estiver configurada.
    """
    from sqlalchemy import select
    from app.models.blacklist_monitor import SystemApiKey
    from app.core.security import decrypt_field

    try:
        result = await db.execute(
            select(SystemApiKey).where(
                SystemApiKey.service == "mxtoolbox",
                SystemApiKey.is_active == True,
            )
        )
        key_obj = result.scalar_one_or_none()

        if not key_obj or not key_obj.api_key_encrypted:
            return None

        api_key = decrypt_field(key_obj.api_key_encrypted)
        if not api_key:
            return None

        return MxToolboxService(api_key=api_key)
    except Exception as e:
        logger.error(f"[MxToolbox] Erro ao obter chave de API do banco: {e}")
        return None

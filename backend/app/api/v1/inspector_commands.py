"""
BR10 NetManager - Inspector Commands API
CRUD de comandos de inspeção editáveis por tipo de dispositivo (vendor).
Permite criar, editar, excluir e listar comandos agrupados por vendor/categoria.
"""
import uuid
import logging
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.auth import get_current_user, require_technician_or_admin, require_admin
from app.core.database import get_db
from app.models.inspector_command import InspectorCommand
from app.models.user import User

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/inspector-commands", tags=["Inspector Commands"])

# ─── Tipos de dispositivo suportados ──────────────────────────────────────────

DEVICE_TYPE_LABELS = {
    "huawei_ne8000": "Huawei NE40E / NE8000",
    "huawei_6730":   "Huawei Switch (S5700/S6730)",
    "generic_olt":   "Huawei OLT (MA5800/MA5600)",
    "vsol_olt":      "VSOL OLT",
    "datacom":       "Datacom",
    "mikrotik":      "Mikrotik RouterOS",
    "cisco":         "Cisco IOS / IOS-XE",
    "juniper":       "Juniper JunOS",
    "generic_router": "Roteador Genérico",
    "generic_switch": "Switch Genérico",
    "other":         "Outro",
}

# Ícones disponíveis por categoria padrão
DEFAULT_CATEGORY_ICONS = {
    "interfaces": "Network",
    "bgp":        "GitBranch",
    "routing":    "Route",
    "ospf":       "Share2",
    "mpls":       "Layers",
    "vrf":        "Lock",
    "system":     "Cpu",
    "logs":       "FileText",
    "arp":        "Link",
    "vlans":      "Layers",
    "stp":        "GitMerge",
    "mac":        "Database",
    "lacp":       "Link",
    "firewall":   "Shield",
    "addresses":  "Globe",
    "boards":     "Server",
    "ont_online": "Wifi",
    "ont_offline": "WifiOff",
    "optical":    "Zap",
    "service_ports": "Plug",
    "dba":        "BarChart2",
    "alarms":     "AlertTriangle",
    "custom":     "Terminal",
}


# ─── Schemas ──────────────────────────────────────────────────────────────────

class CommandCreate(BaseModel):
    device_type: str
    category_id: str
    category_label: str
    category_icon: str = "Terminal"
    command: str
    description: Optional[str] = None
    sort_order: int = 0
    is_active: bool = True


class CommandUpdate(BaseModel):
    category_label: Optional[str] = None
    category_icon: Optional[str] = None
    command: Optional[str] = None
    description: Optional[str] = None
    sort_order: Optional[int] = None
    is_active: Optional[bool] = None


class CommandBulkCreate(BaseModel):
    """Cria múltiplos comandos de uma vez (para importar catálogo)."""
    device_type: str
    category_id: str
    category_label: str
    category_icon: str = "Terminal"
    commands: List[str]  # Lista de comandos


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _build_catalog_from_db(commands: List[InspectorCommand]) -> dict:
    """Constrói estrutura de catálogo a partir dos registros do banco."""
    catalog: dict = {}
    for cmd in commands:
        if not cmd.is_active:
            continue
        dt = cmd.device_type
        cat = cmd.category_id
        if dt not in catalog:
            catalog[dt] = {
                "label": DEVICE_TYPE_LABELS.get(dt, dt),
                "categories": {}
            }
        if cat not in catalog[dt]["categories"]:
            catalog[dt]["categories"][cat] = {
                "label": cmd.category_label,
                "icon": cmd.category_icon,
                "commands": [],
            }
        catalog[dt]["categories"][cat]["commands"].append(cmd.command)
    return catalog


# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.get("")
async def list_commands(
    device_type: Optional[str] = Query(None),
    category_id: Optional[str] = Query(None),
    active_only: bool = Query(True),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Lista todos os comandos, opcionalmente filtrados por device_type e/ou category_id."""
    query = select(InspectorCommand).order_by(
        InspectorCommand.device_type,
        InspectorCommand.category_id,
        InspectorCommand.sort_order,
        InspectorCommand.command,
    )
    if device_type:
        query = query.where(InspectorCommand.device_type == device_type)
    if category_id:
        query = query.where(InspectorCommand.category_id == category_id)
    if active_only:
        query = query.where(InspectorCommand.is_active == True)  # noqa

    result = await db.execute(query)
    commands = result.scalars().all()
    return {"commands": [c.to_dict() for c in commands], "total": len(commands)}


@router.get("/catalog")
async def get_catalog_from_db(
    device_type: Optional[str] = Query(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Retorna o catálogo de comandos no formato usado pelo Device Inspector,
    construído a partir dos registros do banco de dados.
    Se não houver registros no banco, retorna catálogo vazio.
    """
    query = select(InspectorCommand).where(InspectorCommand.is_active == True)  # noqa
    if device_type:
        query = query.where(InspectorCommand.device_type == device_type)
    query = query.order_by(
        InspectorCommand.device_type,
        InspectorCommand.category_id,
        InspectorCommand.sort_order,
    )
    result = await db.execute(query)
    commands = result.scalars().all()

    catalog = _build_catalog_from_db(commands)

    # Se solicitado por device_type específico, retorna só aquele
    if device_type:
        if device_type in catalog:
            return {
                "device_type": device_type,
                "label": catalog[device_type]["label"],
                "categories": catalog[device_type]["categories"],
                "source": "database",
            }
        return {
            "device_type": device_type,
            "label": DEVICE_TYPE_LABELS.get(device_type, device_type),
            "categories": {},
            "source": "database",
        }

    return {"catalog": catalog, "source": "database"}


@router.get("/device-types")
async def list_device_types(
    current_user: User = Depends(get_current_user),
):
    """Lista todos os tipos de dispositivo suportados."""
    return {
        "device_types": [
            {"value": k, "label": v}
            for k, v in DEVICE_TYPE_LABELS.items()
        ]
    }


@router.get("/categories")
async def list_categories(
    device_type: Optional[str] = Query(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Lista categorias disponíveis, opcionalmente filtradas por device_type."""
    query = select(
        InspectorCommand.category_id,
        InspectorCommand.category_label,
        InspectorCommand.category_icon,
        InspectorCommand.device_type,
    ).distinct()

    if device_type:
        query = query.where(InspectorCommand.device_type == device_type)

    result = await db.execute(query)
    rows = result.all()

    seen = {}
    for row in rows:
        key = f"{row.device_type}:{row.category_id}"
        if key not in seen:
            seen[key] = {
                "device_type": row.device_type,
                "category_id": row.category_id,
                "category_label": row.category_label,
                "category_icon": row.category_icon,
            }

    return {"categories": list(seen.values())}


@router.get("/{command_id}")
async def get_command(
    command_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Retorna um comando específico pelo ID."""
    result = await db.execute(
        select(InspectorCommand).where(InspectorCommand.id == command_id)
    )
    cmd = result.scalar_one_or_none()
    if not cmd:
        raise HTTPException(status_code=404, detail="Comando não encontrado.")
    return cmd.to_dict()


@router.post("", status_code=201)
async def create_command(
    body: CommandCreate,
    current_user: User = Depends(require_technician_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """Cria um novo comando de inspeção."""
    if body.device_type not in DEVICE_TYPE_LABELS:
        raise HTTPException(
            status_code=400,
            detail=f"Tipo de dispositivo inválido: '{body.device_type}'. "
                   f"Válidos: {list(DEVICE_TYPE_LABELS.keys())}"
        )

    cmd = InspectorCommand(
        id=str(uuid.uuid4()),
        device_type=body.device_type,
        category_id=body.category_id,
        category_label=body.category_label,
        category_icon=body.category_icon,
        command=body.command.strip(),
        description=body.description,
        sort_order=body.sort_order,
        is_active=body.is_active,
        created_by=current_user.username,
    )
    db.add(cmd)
    await db.commit()
    await db.refresh(cmd)
    logger.info(f"[InspectorCommands] Usuário '{current_user.username}' criou comando: {cmd.command}")
    return cmd.to_dict()


@router.post("/bulk", status_code=201)
async def create_commands_bulk(
    body: CommandBulkCreate,
    current_user: User = Depends(require_technician_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """Cria múltiplos comandos de uma vez para uma categoria."""
    if body.device_type not in DEVICE_TYPE_LABELS:
        raise HTTPException(
            status_code=400,
            detail=f"Tipo de dispositivo inválido: '{body.device_type}'."
        )

    created = []
    for i, command_text in enumerate(body.commands):
        cmd_text = command_text.strip()
        if not cmd_text:
            continue
        cmd = InspectorCommand(
            id=str(uuid.uuid4()),
            device_type=body.device_type,
            category_id=body.category_id,
            category_label=body.category_label,
            category_icon=body.category_icon,
            command=cmd_text,
            sort_order=i,
            is_active=True,
            created_by=current_user.username,
        )
        db.add(cmd)
        created.append(cmd)

    await db.commit()
    logger.info(
        f"[InspectorCommands] Usuário '{current_user.username}' criou {len(created)} comandos "
        f"em {body.device_type}/{body.category_id}"
    )
    return {"created": len(created), "commands": [c.to_dict() for c in created]}


@router.put("/{command_id}")
async def update_command(
    command_id: str,
    body: CommandUpdate,
    current_user: User = Depends(require_technician_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """Atualiza um comando existente."""
    result = await db.execute(
        select(InspectorCommand).where(InspectorCommand.id == command_id)
    )
    cmd = result.scalar_one_or_none()
    if not cmd:
        raise HTTPException(status_code=404, detail="Comando não encontrado.")

    if body.category_label is not None:
        cmd.category_label = body.category_label
    if body.category_icon is not None:
        cmd.category_icon = body.category_icon
    if body.command is not None:
        cmd.command = body.command.strip()
    if body.description is not None:
        cmd.description = body.description
    if body.sort_order is not None:
        cmd.sort_order = body.sort_order
    if body.is_active is not None:
        cmd.is_active = body.is_active

    await db.commit()
    await db.refresh(cmd)
    logger.info(f"[InspectorCommands] Usuário '{current_user.username}' editou comando {command_id}")
    return cmd.to_dict()


@router.delete("/{command_id}", status_code=204)
async def delete_command(
    command_id: str,
    current_user: User = Depends(require_technician_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """Remove um comando."""
    result = await db.execute(
        select(InspectorCommand).where(InspectorCommand.id == command_id)
    )
    cmd = result.scalar_one_or_none()
    if not cmd:
        raise HTTPException(status_code=404, detail="Comando não encontrado.")

    await db.delete(cmd)
    await db.commit()
    logger.info(f"[InspectorCommands] Usuário '{current_user.username}' removeu comando {command_id}")


@router.delete("/bulk/by-category")
async def delete_commands_by_category(
    device_type: str = Query(...),
    category_id: str = Query(...),
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Remove todos os comandos de uma categoria (apenas admin)."""
    result = await db.execute(
        delete(InspectorCommand).where(
            InspectorCommand.device_type == device_type,
            InspectorCommand.category_id == category_id,
        )
    )
    await db.commit()
    deleted = result.rowcount
    logger.info(
        f"[InspectorCommands] Admin '{current_user.username}' removeu {deleted} comandos "
        f"de {device_type}/{category_id}"
    )
    return {"deleted": deleted}


@router.post("/seed")
async def seed_default_commands(
    device_type: Optional[str] = Query(None, description="Seed apenas para este vendor. Omitir = todos."),
    overwrite: bool = Query(False, description="Se True, remove os existentes antes de inserir"),
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    Popula o banco com os comandos padrão do catálogo embutido.
    Use após a primeira instalação ou para restaurar os padrões.
    Requer permissão de admin.
    """
    from app.api.v1.device_inspector import INSPECTION_CATALOG

    total_created = 0
    vendors_seeded = []

    for dt, info in INSPECTION_CATALOG.items():
        if device_type and dt != device_type:
            continue

        if overwrite:
            await db.execute(
                delete(InspectorCommand).where(InspectorCommand.device_type == dt)
            )

        for cat_id, cat in info["categories"].items():
            # Verificar se já existem comandos para evitar duplicatas
            existing = await db.scalar(
                select(InspectorCommand).where(
                    InspectorCommand.device_type == dt,
                    InspectorCommand.category_id == cat_id,
                ).limit(1)
            )
            if existing and not overwrite:
                continue

            for i, command_text in enumerate(cat["commands"]):
                cmd = InspectorCommand(
                    id=str(uuid.uuid4()),
                    device_type=dt,
                    category_id=cat_id,
                    category_label=cat["label"],
                    category_icon=cat.get("icon", "Terminal"),
                    command=command_text,
                    sort_order=i,
                    is_active=True,
                    created_by=current_user.username,
                )
                db.add(cmd)
                total_created += 1

        vendors_seeded.append(dt)

    await db.commit()
    logger.info(
        f"[InspectorCommands] Seed executado por '{current_user.username}': "
        f"{total_created} comandos criados para {vendors_seeded}"
    )
    return {
        "created": total_created,
        "vendors": vendors_seeded,
        "message": f"{total_created} comandos criados com sucesso.",
    }

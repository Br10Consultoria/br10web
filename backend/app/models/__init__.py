"""BR10 NetManager - Models Package"""
from app.models.base import Base
from app.models.user import User, UserSession, UserRole
from app.models.client import Client, VendorGroup, Vendor, VendorModel, DeviceGroupType
from app.models.device import (
    Device, DeviceVlan, DevicePort, DeviceCredential,
    DevicePhoto, DeviceBackup, DeviceType, DeviceStatus,
    ConnectionProtocol, PortType, PortStatus
)
from app.models.vpn import VpnConfig, StaticRoute, VpnType, VpnStatus
from app.models.audit import AuditLog, AuditAction
from app.models.automation import CommandTemplate, CommandExecution, CommandCategory, ExecutionStatus
from app.models.inspector_command import InspectorCommand
from app.models.backup_schedule import (
    BackupSchedule, BackupExecution, BackupScheduleStatus, BackupRunStatus as BackupRunStatusEnum,
)
from app.models.rpki_monitor import RpkiMonitor, RpkiCheck
from app.models.blacklist_monitor import SystemApiKey, BlacklistMonitor, BlacklistCheck
from app.models.snmp_monitor import SnmpTarget, SnmpMetric, SnmpAlert, NetconfActionLog
from app.models.cgnat import CgnatConfig, CgnatMapping
from app.models.permissions import UserPermission, UserClientScope, MODULES, ACCESS_LEVELS, MODULE_OPERATIONS
from app.models.playbook import (
    Playbook, PlaybookStep, PlaybookExecution, PlaybookRunStatus,
    AIProviderConfig, AIAnalysis, AIAnalysisStatus, AIProvider,
    PlaybookStatus, PlaybookStepType,
)

__all__ = [
    "Base",
    "User", "UserSession", "UserRole",
    "Client", "VendorGroup", "Vendor", "VendorModel", "DeviceGroupType",
    "Device", "DeviceVlan", "DevicePort", "DeviceCredential",
    "DevicePhoto", "DeviceBackup", "DeviceType", "DeviceStatus",
    "ConnectionProtocol", "PortType", "PortStatus",
    "VpnConfig", "StaticRoute", "VpnType", "VpnStatus",
    "AuditLog", "AuditAction",
    "CommandTemplate", "CommandExecution", "CommandCategory", "ExecutionStatus",
    "InspectorCommand",
    # Backup de dispositivos
    "BackupSchedule", "BackupExecution", "BackupScheduleStatus", "BackupRunStatusEnum",
    # Playbooks e AI
    "Playbook", "PlaybookStep", "PlaybookExecution", "PlaybookRunStatus",
    "AIProviderConfig", "AIAnalysis", "AIAnalysisStatus", "AIProvider",
    "PlaybookStatus", "PlaybookStepType",
    # Monitor RPKI
    "RpkiMonitor", "RpkiCheck",
    # Monitor de Blacklist / Reputação IP
    "SystemApiKey", "BlacklistMonitor", "BlacklistCheck",
    # Monitoramento SNMP + Gestão NETCONF/SSH
    "SnmpTarget", "SnmpMetric", "SnmpAlert", "NetconfActionLog",
    # CGNAT
    "CgnatConfig", "CgnatMapping",
    # Permissões granulares
    "UserPermission", "UserClientScope", "MODULES", "ACCESS_LEVELS", "MODULE_OPERATIONS",
]

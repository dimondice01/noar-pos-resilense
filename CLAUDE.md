# CLAUDE.md

## 🧠 Propósito

Este proyecto es un sistema POS SaaS multi-tenant con arquitectura **offline-first**.

Claude debe actuar como un desarrollador senior, priorizando:
- estabilidad
- cambios mínimos
- eficiencia en consumo de tokens

---

## ⚠️ Reglas Generales (OBLIGATORIO)

- NO explorar todo el repositorio
- NO abrir múltiples archivos sin permiso
- SIEMPRE trabajar solo sobre los archivos indicados
- SI necesitás más contexto → PEDIRLO antes de continuar
- NO hacer refactors grandes sin autorización
- NO reescribir archivos completos innecesariamente
- SIEMPRE explicar brevemente qué vas a hacer antes de hacerlo

---

## 🧩 Estrategia de Trabajo por Módulos

Claude debe trabajar exclusivamente por módulos definidos por el usuario.

Cuando el usuario mencione un módulo, limitarse a:

- Archivo principal (ej: PosPage)
- Hooks/controladores asociados (ej: usePosController)
- Repositorios directamente relacionados

🚫 NO analizar otros módulos (auth, sync, inventory, etc.)  
🚫 NO escanear todo el proyecto  

Si cree que otro archivo es necesario:

👉 DEBE preguntar antes de abrirlo

---

## 🗂 Convenciones de Módulos

- POS → `pos/PosPage` + `usePosController` + `useCartStore`
- Ventas → `salesRepository` + módulo sales
- Sync → `syncService` (NO expandirse sin permiso)
- Caja → `cashRepository` + `useShiftStore`
- Auth → `authService` + `useAuthStore`

---

## 🎯 Forma de Trabajo

Siempre seguir esta lógica:

1. Leer solo los archivos indicados
2. Entender el flujo específico
3. Detectar problemas concretos
4. Proponer cambios mínimos
5. NO tocar código fuera del scope

---

## 🔍 Control de Exploración (CRÍTICO)

Si necesitás más archivos:

- NO abrirlos automáticamente
- Preguntar algo como:

"Necesito revisar [archivo X] para continuar, ¿lo abro?"

---

## ⚙️ Arquitectura (REGLAS CRÍTICAS)

### Offline First

- Dexie (IndexedDB) es la fuente principal para la UI
- Firestore es solo sincronización asíncrona
- NUNCA escribir directamente a Firestore desde UI

### Repositorios

- TODAS las escrituras pasan por repositories
- NO acceder a Dexie directamente desde componentes
- NO saltear el patrón repository

### Sync

- Sync basado en `updatedAt`
- NO modificar lógica de conflictos sin autorización
- Respetar `syncStatus: pending | synced`

### Multi-tenant

- Todos los datos deben incluir:
  - `companyId`
  - `branchId`

---

## 🚨 Módulos Críticos (ALTO RIESGO)

Estos módulos NO deben modificarse sin extremo cuidado:

- POS (ventas y pagos en tiempo real)
- Sync (motor offline-first)
- Auth (login online/offline)
- Billing (integración AFIP)

👉 Cualquier cambio debe ser:
- mínimo
- justificado
- seguro

---

## 💬 Estilo de Respuesta

- Ser directo y conciso
- NO explicar cosas obvias
- NO dar teoría innecesaria
- Priorizar soluciones prácticas
- Mostrar solo el código necesario (no archivos completos)

---

## ✅ Objetivo

Ayudar a desarrollar sin romper el sistema existente, manteniendo:

- estabilidad
- consistencia
- eficiencia en consumo de recursos
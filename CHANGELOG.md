# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es/1.0.0/).

---

## [Unreleased] — rama `cliente/el-salvador`

### Fix
- **POS · Búsqueda pesable** (`PosPage.jsx`): al seleccionar un producto pesable con Enter, el input de búsqueda ahora se limpia inmediatamente — antes el usuario debía borrarlo a mano para escanear el siguiente producto.
- **POS · PaymentModal** (`PaymentModal.jsx`, `usePosController.js`): ingresar `0` como monto entregado con un cliente seleccionado ahora se trata como pago parcial completo — el total va 100% a Cuenta Corriente, independientemente del medio de pago elegido.
- **Analytics** (`AnalyticsDashboard.jsx`): eliminadas todas las clases `dark:` de Tailwind que provocaban que la pantalla se mostrara en modo oscuro. Colores unificados con el sistema de diseño de la app (`sys-*`, `brand`, `white`).

### Added
- **ClientDashboard · Historial completo** (`ClientDashboard.jsx`, `salesRepository.js`): el historial ahora incluye ventas pagadas al contado (no solo deudas). Se agrega `getSalesByClientId()` en `salesRepository` y se fusionan los resultados con el ledger, deduplicando por `referenceId` para evitar duplicados. Las ventas contado se muestran en azul con saldo `—` (no afectan el cálculo de deuda).
- **ClientDashboard · SaleViewModal** (`ClientDashboard.jsx`): modal ligero para ver el detalle de una venta (ítems, totales, fecha, método de pago) sin abrir el `TicketModal` orientado a impresión. Incluye botón "Imprimir" que delega al flujo existente.
- **ClientDashboard · Botones de acción visibles** (`ClientDashboard.jsx`): los botones 👁 (ver) y 🖨 (imprimir) de cada fila del historial ahora son siempre visibles con fondo de color, en lugar de aparecer solo al hacer hover. Se reemplazó la columna "Sucursal" por una badge de tipo (`Deuda` / `Contado` / `Pago` / `Devolución`) para lectura instantánea.

---

## [2425eba] — `feat: producto-caja, resiliencia offline y mejoras UI`

### Added / Fixed
- **Producto-Caja**: integración del módulo de productos con la caja activa.
- **Resiliencia Offline**: hardening del patrón offline-first en múltiples módulos (ventas, inventario, caja/shift, POS). Delta Sync inicial con `syncInitialX()`, listeners real-time con `dispatchEvent(CustomEvent)`, protección de registros pendientes al sincronizar desde el cloud.
- **Mejoras UI generales**: ajustes visuales en múltiples pantallas.

---

## Historial anterior

Los commits previos (`cb06e1d save`, `492280a claude`, `0853ce6 sad`, `359e5c8 asdd`) corresponden a trabajo en progreso sin descripción estructurada.

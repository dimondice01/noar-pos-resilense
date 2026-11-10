// Ventas cuya subida optimista (salesRepository) sigue esperando el ack de Firestore.
// syncPendingSales las saltea para no re-escribir la misma venta en paralelo.
// Módulo aparte para no crear un import circular salesRepository <-> syncService.
export const inFlightSales = new Set();

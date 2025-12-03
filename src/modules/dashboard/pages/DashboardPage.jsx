// Ejemplo para DashboardPage.jsx
import React from 'react';
import { Card } from '../../../core/ui/Card';
import { Button } from '../../../core/ui/Button';

export const DashboardPage = () => {
  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-2xl font-bold text-sys-900">Dashboard</h2>
        <p className="text-sys-500">Resumen general del negocio</p>
      </header>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
            <h3 className="text-sys-500 text-sm font-medium">Ventas Hoy</h3>
            <p className="text-3xl font-bold text-sys-900 mt-2">$ 0.00</p>
        </Card>
        {/* Prueba de estilos */}
        <Card className="flex flex-col justify-center items-start gap-4">
            <p>Prueba de Componentes</p>
            <Button>Nuevo Venta</Button>
        </Card>
      </div>
    </div>
  );
};
// ¡Recuerda exportar default o const según prefieras, mantén consistencia!
// Aquí usé export const.
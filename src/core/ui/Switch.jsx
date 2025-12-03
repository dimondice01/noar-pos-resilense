import React from 'react';
import { cn } from '../utils/cn';

export const Switch = ({ checked, onCheckedChange, label }) => {
  return (
    <label className="flex items-center gap-3 cursor-pointer group">
      <div className="relative">
        <input 
          type="checkbox" 
          className="sr-only" 
          checked={checked} 
          onChange={(e) => onCheckedChange(e.target.checked)} 
        />
        <div className={cn(
          "w-11 h-6 bg-sys-200 rounded-full transition-colors duration-200 ease-in-out peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-brand/20",
          checked ? "bg-brand" : "group-hover:bg-sys-300"
        )}></div>
        <div className={cn(
          "absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform duration-200 ease-in-out shadow-sm",
          checked ? "translate-x-5" : "translate-x-0"
        )}></div>
      </div>
      {label && <span className="text-sm font-medium text-sys-700 select-none">{label}</span>}
    </label>
  );
};
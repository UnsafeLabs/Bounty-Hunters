import { create } from "zustand";
export type ToastType = "success"|"error"|"info"|"warning";
export interface Toast{id:string;type:ToastType;message:string;duration?:number;}
export interface NotificationState{toasts:Toast[];addToast:(type:ToastType,message:string,duration?:number)=>void;removeToast:(id:string)=>void;clearAll:()=>void;}
let c=0;
export const useNotificationStore=create<NotificationState>((set)=>({toasts:[],addToast:(type,message,duration=5000)=>{const id="toast-"+(++c);set((s)=>({toasts:[...s.toasts,{id,type,message,duration}]}));if(duration>0)setTimeout(()=>set((s)=>({toasts:s.toasts.filter(t=>t.id!==id)})),duration);},removeToast:(id)=>set((s)=>({toasts:s.toasts.filter(t=>t.id!==id)})),clearAll:()=>set({toasts:[]})}));
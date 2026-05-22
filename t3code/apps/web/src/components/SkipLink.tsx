 "use client";
 
 import { type ReactNode, forwardRef, Ref } from "react";
 
 interface SkipLinkProps {
   children: ReactNode;
   href: string;
   onSkip: () => void;
 }
 
 const SkipLink = forwardRef<HTMLAnchorElement, SkipLinkProps>((props, ref) => {
   return (
     <a 
       ref={ref}
       href={props.href}
       onClick={(e) => {
         e.preventDefault();
         props.onSkip();
       }}
       className="skip-link"
       aria-label="Skip to content"
     >
       {props.children}
     </a>
   );
 });
 
 export default SkipLink;
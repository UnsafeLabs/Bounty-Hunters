-- Generic cache with Finalize_Element so Evict frees access values (issue #564)
generic
   type Key_Type is private;
   type Element_Type is private;
   with function Hash (K : Key_Type) return Natural;
   with procedure Finalize_Element (E : in out Element_Type);
package TLS_Cache is
   procedure Insert (K : Key_Type; E : Element_Type);
   procedure Evict (K : Key_Type);
end TLS_Cache;

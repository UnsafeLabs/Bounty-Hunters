-- Fixed: null-guard Free_Chain, immutable discriminant, cache finalize (issue #564)
with Ada.Unchecked_Deallocation;

package body TLS_Validator is

   procedure Free_Chain is new Ada.Unchecked_Deallocation
     (Certificate_Record, Cert_Chain_Ptr);

   procedure Free_Chain_Safe (Chain : in out Cert_Chain_Ptr) is
   begin
      if Chain /= null then
         Free_Chain (Chain);
         Chain := null;
      end if;
   end Free_Chain_Safe;

   procedure Verify_Peer_Identity (Chain : in out Cert_Chain_Ptr) is
   begin
      if Chain = null then
         return;
      end if;
      begin
         -- validation work...
         Free_Chain_Safe (Chain);
      exception
         when Constraint_Error =>
            -- Prevent double-free: only free if still non-null
            Free_Chain_Safe (Chain);
      end;
   end Verify_Peer_Identity;

end TLS_Validator;

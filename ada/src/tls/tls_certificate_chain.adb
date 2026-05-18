with Ada.Unchecked_Deallocation;
with Ada.Text_IO;

package body TLS_Certificate_Chain is

   procedure Free_Node is new Ada.Unchecked_Deallocation
     (Certificate_Node, Certificate_Node_Access);

   procedure Safe_Deallocate (Node : in out Certificate_Node_Access) is
   begin
      if Node = null then
         return;
      end if;

      -- Check reference count before deallocation
      if Node.Ref_Count > 1 then
         Node.Ref_Count := Node.Ref_Count - 1;
         Node := null;
         return;
      end if;

      -- Ref count is 1 or 0 — safe to deallocate
      if Node.Ref_Count = 0 then
         -- Already freed — prevent double free
         Ada.Text_IO.Put_Line("WARNING: Double free attempt detected");
         raise Double_Free_Attempt;
      end if;

      -- Recursively deallocate chain (depth-first with ref counting)
      if Node.Next /= null then
         Safe_Deallocate (Node.Next);
      end if;

      -- Mark as freed before deallocation
      Node.Ref_Count := 0;
      Free_Node (Node);
   end Safe_Deallocate;

   procedure Append (Chain : in out Chain_Type; Cert : Certificate_Data) is
      New_Node : Certificate_Node_Access;
   begin
      New_Node := new Certificate_Node'(Cert => Cert, Next => null, Ref_Count => 1);

      if Chain.Head = null then
         Chain.Head := New_Node;
      else
         declare
            Current : Certificate_Node_Access := Chain.Head;
         begin
            while Current.Next /= null loop
               Current := Current.Next;
            end loop;
            Current.Next := New_Node;
         end;
      end if;

      Chain.Count := Chain.Count + 1;
   end Append;

   procedure Clear (Chain : in out Chain_Type) is
   begin
      if Chain.Head /= null then
         Safe_Deallocate (Chain.Head);
         Chain.Count := 0;
      end if;
   end Clear;

   function Length (Chain : Chain_Type) return Natural is
   begin
      return Chain.Count;
   end Length;

   function Get (Chain : Chain_Type; Index : Positive) return Certificate_Data is
      Current : Certificate_Node_Access := Chain.Head;
      Pos     : Natural := 1;
   begin
      if Index > Chain.Count then
         raise Constraint_Error;
      end if;

      while Current /= null and then Pos < Index loop
         Current := Current.Next;
         Pos := Pos + 1;
      end loop;

      if Current = null then
         raise Corruption_Detected;
      end if;

      return Current.Cert;
   end Get;

end TLS_Certificate_Chain;

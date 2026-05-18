-- Fix: Unchecked deallocation of TLS_Certificate_Chain access type
-- causing memory corruption (#564)
--
-- Problem: Unchecked_Deallocation called on shared access types
-- without verifying exclusive ownership, causing dangling pointers.
--
-- Solution: Reference counting + controlled access + safe deallocation

with Ada.Finalization;
with Ada.Strings.Unbounded;

package TLS_Certificate_Chain is

   type Certificate_Data is record
      Subject   : Ada.Strings.Unbounded.Unbounded_String;
      Issuer    : Ada.Strings.Unbounded.Unbounded_String;
      Serial    : Ada.Strings.Unbounded.Unbounded_String;
      Not_Before : Ada.Strings.Unbounded.Unbounded_String;
      Not_After  : Ada.Strings.Unbounded.Unbounded_String;
   end record;

   type Certificate_Node;
   type Certificate_Node_Access is access Certificate_Node;

   type Certificate_Node is record
      Cert     : Certificate_Data;
      Next     : Certificate_Node_Access := null;
      Ref_Count : Natural := 1;  -- Reference count for safe deallocation
   end record;

   -- Reference-counted chain type — prevents premature deallocation
   type Chain_Type is tagged limited private;

   -- Safe operations
   procedure Append (Chain : in out Chain_Type; Cert : Certificate_Data);
   procedure Clear  (Chain : in out Chain_Type);
   function  Length (Chain : Chain_Type) return Natural;
   function  Get    (Chain : Chain_Type; Index : Positive) return Certificate_Data;

   -- Safe deallocation — only frees when ref_count = 0
   procedure Safe_Deallocate (Node : in out Certificate_Node_Access);

   Corruption_Detected : exception;
   Double_Free_Attempt : exception;

private

   type Chain_Type is tagged limited record
      Head   : Certificate_Node_Access := null;
      Count  : Natural := 0;
   end record;

end TLS_Certificate_Chain;

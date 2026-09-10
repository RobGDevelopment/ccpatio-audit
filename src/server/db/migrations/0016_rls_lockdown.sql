-- 0016_rls_lockdown.sql
-- Enforce strict Row Level Security (RLS) on Mission Control tables

-- 1. user_roles
ALTER TABLE "user_roles" ENABLE ROW LEVEL SECURITY;

-- Allow users to view their own role
CREATE POLICY "Users can view own role" 
ON "user_roles" 
FOR SELECT 
USING (auth.uid() = id);

-- Allow SuperAdmin to manage all roles
-- Note: Subquery avoids infinite recursion because the SELECT policy allows auth.uid() = id
CREATE POLICY "SuperAdmins can manage all roles" 
ON "user_roles" 
FOR ALL 
USING (
  (SELECT role FROM user_roles WHERE id = auth.uid()) = 'SuperAdmin'
);


-- 2. vendor_credentials
ALTER TABLE "vendor_credentials" ENABLE ROW LEVEL SECURITY;

-- Allow SuperAdmin and IT_Admin to view and update vendor credentials
CREATE POLICY "Admins can manage vendor credentials" 
ON "vendor_credentials" 
FOR ALL 
USING (
  (SELECT role FROM user_roles WHERE id = auth.uid()) IN ('SuperAdmin', 'IT_Admin')
);

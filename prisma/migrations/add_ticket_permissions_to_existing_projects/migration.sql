-- Add ticket permissions to existing projects

DO $$
DECLARE
    perm_read_own_id TEXT;
    perm_read_all_id TEXT;
    perm_create_id TEXT;
    perm_respond_id TEXT;
    perm_manage_id TEXT;
    role_id TEXT;
BEGIN
    -- Get permission IDs
    SELECT id INTO perm_read_own_id FROM "Permission" WHERE key = 'ticket.read_own';
    SELECT id INTO perm_read_all_id FROM "Permission" WHERE key = 'ticket.read_all';
    SELECT id INTO perm_create_id FROM "Permission" WHERE key = 'ticket.create';
    SELECT id INTO perm_respond_id FROM "Permission" WHERE key = 'ticket.respond';
    SELECT id INTO perm_manage_id FROM "Permission" WHERE key = 'ticket.manage';

    -- Owner roles: add all ticket permissions
    FOR role_id IN SELECT id FROM "ProjectRole" WHERE "isOwner" = true LOOP
        IF perm_read_own_id IS NOT NULL THEN
            INSERT INTO "ProjectRolePermission" ("roleId", "permissionId", "createdAt")
            VALUES (role_id, perm_read_own_id, NOW())
            ON CONFLICT ("roleId", "permissionId") DO NOTHING;
        END IF;
        IF perm_read_all_id IS NOT NULL THEN
            INSERT INTO "ProjectRolePermission" ("roleId", "permissionId", "createdAt")
            VALUES (role_id, perm_read_all_id, NOW())
            ON CONFLICT ("roleId", "permissionId") DO NOTHING;
        END IF;
        IF perm_create_id IS NOT NULL THEN
            INSERT INTO "ProjectRolePermission" ("roleId", "permissionId", "createdAt")
            VALUES (role_id, perm_create_id, NOW())
            ON CONFLICT ("roleId", "permissionId") DO NOTHING;
        END IF;
        IF perm_respond_id IS NOT NULL THEN
            INSERT INTO "ProjectRolePermission" ("roleId", "permissionId", "createdAt")
            VALUES (role_id, perm_respond_id, NOW())
            ON CONFLICT ("roleId", "permissionId") DO NOTHING;
        END IF;
        IF perm_manage_id IS NOT NULL THEN
            INSERT INTO "ProjectRolePermission" ("roleId", "permissionId", "createdAt")
            VALUES (role_id, perm_manage_id, NOW())
            ON CONFLICT ("roleId", "permissionId") DO NOTHING;
        END IF;
    END LOOP;

    -- Maintainer roles: add all ticket permissions
    INSERT INTO "ProjectRolePermission" ("roleId", "permissionId", "createdAt")
    SELECT pr.id, p.id, NOW()
    FROM "ProjectRole" pr
    CROSS JOIN "Permission" p
    WHERE pr.name = 'Maintainer'
    AND p.key IN ('ticket.read_all', 'ticket.create', 'ticket.respond', 'ticket.manage')
    ON CONFLICT ("roleId", "permissionId") DO NOTHING;

    -- Developer roles: add ticket.read_all and ticket.respond
    INSERT INTO "ProjectRolePermission" ("roleId", "permissionId", "createdAt")
    SELECT pr.id, p.id, NOW()
    FROM "ProjectRole" pr
    CROSS JOIN "Permission" p
    WHERE pr.name = 'Developer'
    AND p.key IN ('ticket.read_all', 'ticket.respond')
    ON CONFLICT ("roleId", "permissionId") DO NOTHING;

    -- Viewer roles: add ticket.read_all
    INSERT INTO "ProjectRolePermission" ("roleId", "permissionId", "createdAt")
    SELECT pr.id, p.id, NOW()
    FROM "ProjectRole" pr
    CROSS JOIN "Permission" p
    WHERE pr.name = 'Viewer'
    AND p.key = 'ticket.read_all'
    ON CONFLICT ("roleId", "permissionId") DO NOTHING;

    -- Create Client role if not exists for each project
    INSERT INTO "ProjectRole" (id, "projectId", name, description, "isOwner", "isDefault", "createdAt", "updatedAt")
    SELECT gen_random_uuid()::text, p.id, 'Client', 'Can create and view own tickets.', false, false, NOW(), NOW()
    FROM "Project" p
    WHERE NOT EXISTS (
        SELECT 1 FROM "ProjectRole" pr2 
        WHERE pr2."projectId" = p.id AND pr2.name = 'Client'
    );

    -- Client roles: add ticket.read_own and ticket.create
    INSERT INTO "ProjectRolePermission" ("roleId", "permissionId", "createdAt")
    SELECT pr.id, p.id, NOW()
    FROM "ProjectRole" pr
    CROSS JOIN "Permission" p
    WHERE pr.name = 'Client'
    AND p.key IN ('ticket.read_own', 'ticket.create')
    ON CONFLICT ("roleId", "permissionId") DO NOTHING;

END $$;

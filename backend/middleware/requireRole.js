/**
 * Require the authenticated user to have one of the allowed roles.
 * Must be used after requireAuth (which sets req.admin).
 *
 * Usage: router.delete('/thing/:id', requireAuth, requireRole('admin'), handler)
 */
export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    // Deny by default: an account with no role gets no access.
    const role = req.admin?.role;
    if (!role || !allowedRoles.includes(role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    return next();
  };
}

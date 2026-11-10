/**
 * Require the authenticated user to have one of the allowed roles.
 * Must be used after requireAuth (which sets req.admin).
 *
 * Usage: router.delete('/thing/:id', requireAuth, requireRole('admin'), handler)
 */
export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    const role = req.admin?.role || 'admin';
    if (!allowedRoles.includes(role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    return next();
  };
}

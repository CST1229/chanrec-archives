// Archives-specific script
import db from "../src/sqlitedb.js";
db.exec("VACUUM");
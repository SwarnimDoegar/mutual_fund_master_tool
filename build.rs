// Migrations are embedded with include_dir!, which cargo does not track; rebuild when they change.
fn main() {
    println!("cargo:rerun-if-changed=sql/migrations");
}

{
  description = "yarn-berry-builder";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/95ea544c84ebed84a31896b0ecea2570e5e0e236";
    flake-utils.url = "github:numtide/flake-utils";
    flake-compat = {
      url = "github:edolstra/flake-compat";
      flake = false;
    };
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
      ...
    }:
    (flake-utils.lib.eachDefaultSystem (
      system:
      (
        let
          pkgs = nixpkgs.legacyPackages.${system};
          inherit (pkgs) coreutils lib yarn;
          yarnBin = lib.getExe yarn;
          yarn-build-cli = pkgs.writers.writeBashBin "yarn-build-cli" ''
            set -euo pipefail
            ${yarnBin}
            ${yarnBin} build:pnp:hook
            ${yarnBin} build:cli
            ${coreutils}/bin/mv ./packages/yarnpkg-cli/bundles/yarn.js ./packages/yarnpkg-cli/bundles/yarn-min.js
          '';
          yarn-build-and-commit = pkgs.writers.writeBashBin "yarn-build-and-commit" ''
            set -euo pipefail
            ${lib.getExe yarn-build-cli}
            ${lib.getExe pkgs.git} add -A
            ${lib.getExe pkgs.git} commit -m "update yarn cli bundle and hook"
          '';
        in
        {
          packages.default = yarn-build-and-commit;
          packages.yarn-build-cli = yarn-build-cli;
          devShells.default = pkgs.mkShell {
            name = "yarn-berry-builder";

            packages = with pkgs; [
              nodejs
              yarn

              yarn-build-cli
              yarn-build-and-commit

              # needed to build mozjpeg
              autoconf
              automake
              gnumake
              libpng
              libtool
              nasm
              pkg-config
              python3
              libsecret
            ];
          };
        }
      )
    ));
}

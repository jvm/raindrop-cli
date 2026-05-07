class RaindropCli < Formula
  desc "Agent-friendly CLI for Raindrop.io"
  homepage "https://github.com/jvm/raindrop-cli"
  url "https://registry.npmjs.org/@mocito/raindrop-cli/-/raindrop-cli-0.2.0.tgz"
  sha256 "04f9a1ee07d36da81f19cc5b60964560321479af2d473e0fa4c987a32fd4d9bd"
  license "MIT"

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink libexec.glob("bin/*")
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/raindrop --version")
  end
end

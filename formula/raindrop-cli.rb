class RaindropCli < Formula
  desc "Agent-friendly CLI for Raindrop.io"
  homepage "https://github.com/jvm/raindrop-cli"
  url "https://registry.npmjs.org/@mocito/raindrop-cli/-/raindrop-cli-0.1.1.tgz"
  sha256 "3a8a97a56b7b16dfd2531779ca05b7037e9801ac02ec827048be07e747749282"
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
